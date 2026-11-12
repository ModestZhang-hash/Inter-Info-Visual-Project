"""Discrete-event simulator for one frozen workload instance.

Each arrival is assigned to one destination. Compute is FIFO, one server per
node. Each nonlocal node has one FIFO transfer channel shared by upload and
return. There is no preemption, reassignment, or future-arrival input.
A local gateway task has no transfer. A nonlocal task completes only after
its return transfer. Queue wait is not counted as active compute energy.
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field

from topic3.policies import projected_task_energy
from topic3.workload import SCHEMA_VERSION

SIMULATOR_VERSION = "topic3-simulator-p2-1"
PROVISIONAL_RANDOM_SEED = 11


@dataclass
class _Job:
    kind: str
    task_id: str
    node_id: str
    duration: float
    start: float | None = None
    end: float | None = None


@dataclass
class _Server:
    busy_until: float = 0.0
    queue: list = field(default_factory=list)
    running: _Job | None = None


@dataclass
class _Progress:
    task_id: str
    destination_id: str | None
    compute_cycles: float
    upload_bytes: int
    return_bytes: int
    status: str = "pending"
    failure_reason: str | None = None
    upload_start: float | None = None
    upload_end: float | None = None
    compute_start: float | None = None
    compute_end: float | None = None
    return_start: float | None = None
    return_end: float | None = None
    completion: float | None = None
    compute_energy: float | None = None
    transfer_energy: float | None = None


class Simulator:
    def __init__(self, manifest, deadline_s: float | None = None):
        nodes = manifest["topology"]["nodes"]
        self.manifest = manifest
        self.deadline_s = deadline_s
        self.gateway = manifest["topology"]["gateway_node_id"]
        self.nodes = {node["node_id"]: node for node in nodes}
        self.node_order = [node["node_id"] for node in nodes]
        if self.gateway not in self.nodes:
            raise ValueError("Gateway node is missing from the topology")
        self.cpu = {node_id: _Server() for node_id in self.node_order}
        self.channel = {node_id: _Server() for node_id in self.node_order if node_id != self.gateway}
        self.progress: dict[str, _Progress] = {}
        self.history: list[tuple[dict, str]] = []
        self.heap: list[tuple[float, int, int, _Job]] = []
        self._seq = 0

    def run(self, instance, policy) -> list[dict]:
        if getattr(policy, "policy_config_id", None) == "random" and getattr(policy, "policy_seed", None) is None:
            raise ValueError("Random policy requires a recorded seed")
        tasks = list(instance["tasks"])
        ordered = sorted(tasks, key=lambda task: (task["arrival_s"], task["task_id"]))
        if [task["task_id"] for task in ordered] != [task["task_id"] for task in tasks]:
            raise ValueError("Instance tasks must already be ordered by arrival_s, task_id")
        for task in ordered:
            self._drain_until(task["arrival_s"])
            destination = self._choose(task, policy)
            self.history.append((task, destination))
            self._start_task(task, destination, task["arrival_s"])
        self._drain_until(math.inf)
        for task in ordered:
            if task["task_id"] not in self.progress:
                raise RuntimeError(f"Task {task['task_id']} was never scheduled")
            if self.progress[task["task_id"]].status == "pending":
                self._fail(task["task_id"], "task did not complete")
        return [self._event(instance, task) for task in ordered]

    def _choose(self, task, policy) -> str:
        arrived = [old["task_id"] for old, _destination in self.history]
        arrived.append(task["task_id"])
        assigned_max = self._history_max_completion()
        min_arrival = min([old["arrival_s"] for old, _destination in self.history] + [task["arrival_s"]])

        def predict_completion(destination, current=task):
            return self._predict(current, destination)

        def predict_energy(destination, current=task):
            if destination not in self.nodes:
                return None
            return projected_task_energy(current, self.nodes[destination], self.gateway)

        def predict_makespan_increase(destination, current=task):
            completion = predict_completion(destination)
            if completion is None:
                return None
            if assigned_max is None:
                return completion - min_arrival
            return (max(assigned_max, completion) - min_arrival) - (assigned_max - min_arrival)

        observable = {
            "now_s": task["arrival_s"],
            "destination_ids": list(self.node_order),
            "arrived_task_ids": arrived,
            "predict_completion_s": predict_completion,
            "predict_task_energy_j": predict_energy,
            "predict_makespan_increase_s": predict_makespan_increase,
            "decision_features": self._decision_features(task),
        }
        return policy.choose(task, observable)

    def _decision_features(self, task) -> dict:
        """Raw snapshot at arrival. Heuristics do not read it. The current task is not yet queued."""
        now = task["arrival_s"]
        nodes = []
        for node_id in self.node_order:
            cpu_queue, cpu_busy = _server_snapshot(self.cpu[node_id], now)
            if node_id == self.gateway:
                channel_queue, channel_busy = 0, 0.0
            else:
                channel_queue, channel_busy = _server_snapshot(self.channel[node_id], now)
            nodes.append({
                "node_id": node_id,
                "cpu_queue_length": cpu_queue,
                "cpu_remaining_busy_s": cpu_busy,
                "channel_queue_length": channel_queue,
                "channel_remaining_busy_s": channel_busy,
                "projected_completion_s": self._predict(task, node_id),
                "projected_task_energy_j": projected_task_energy(task, self.nodes[node_id], self.gateway),
            })
        return {
            "task_id": task["task_id"],
            "compute_cycles": task["compute_cycles"],
            "upload_bytes": task["upload_bytes"],
            "return_bytes": task["return_bytes"],
            "nodes": nodes,
        }

    def _predict(self, task, destination: str):
        clone = Simulator(self.manifest, deadline_s=self.deadline_s)
        for old_task, old_destination in self.history:
            clone._drain_until(old_task["arrival_s"])
            clone._start_task(old_task, old_destination, old_task["arrival_s"])
        clone._drain_until(task["arrival_s"])
        clone._start_task(task, destination, task["arrival_s"])
        clone._drain_until(math.inf)
        progress = clone.progress.get(task["task_id"])
        if progress is None or progress.status != "complete":
            return None
        return progress.completion

    def _history_max_completion(self):
        if not self.history:
            return None
        clone = Simulator(self.manifest, deadline_s=self.deadline_s)
        for old_task, old_destination in self.history:
            clone._drain_until(old_task["arrival_s"])
            clone._start_task(old_task, old_destination, old_task["arrival_s"])
        clone._drain_until(math.inf)
        completions = [item.completion for item in clone.progress.values() if item.status == "complete" and item.completion is not None]
        if not completions:
            return None
        return max(completions)

    def _start_task(self, task, destination: str, now: float) -> None:
        known = destination if destination in self.nodes else None
        progress = _Progress(
            task["task_id"], known, task["compute_cycles"], task["upload_bytes"], task["return_bytes"]
        )
        self.progress[task["task_id"]] = progress
        if destination not in self.nodes:
            self._fail(task["task_id"], "unknown destination")
            return
        if destination == self.gateway:
            self._enqueue(self.cpu[destination], _Job("compute", task["task_id"], destination, _compute_seconds(task["compute_cycles"], self.nodes[destination])), now)
            return
        rate = self.nodes[destination].get("link_rate_bps")
        if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate) or rate <= 0:
            self._fail(task["task_id"], "nonlocal node has no link rate")
            return
        self._enqueue(self.channel[destination], _Job("upload", task["task_id"], destination, _transfer_seconds(task["upload_bytes"], rate)), now)

    def _enqueue(self, server: _Server, job: _Job, now: float) -> None:
        server.queue.append(job)
        self._pump(server, now)

    def _pump(self, server: _Server, now: float) -> None:
        if server.running is not None or not server.queue:
            return
        job = server.queue.pop(0)
        start = max(now, server.busy_until)
        end = start + job.duration
        if self.deadline_s is not None and end > self.deadline_s:
            self._fail(job.task_id, "deadline exceeded")
            self._pump(server, now)
            return
        job.start = start
        job.end = end
        server.busy_until = end
        server.running = job
        heapq.heappush(self.heap, (end, 0, self._seq, job))
        self._seq += 1

    def _drain_until(self, limit: float) -> None:
        while self.heap and self.heap[0][0] <= limit:
            _end, _priority, _seq, job = heapq.heappop(self.heap)
            self._finish(job)

    def _finish(self, job: _Job) -> None:
        server = self.cpu[job.node_id] if job.kind == "compute" else self.channel[job.node_id]
        if server.running is not job:
            raise RuntimeError(f"Completion order broke FIFO for {job.task_id}")
        server.running = None
        progress = self.progress[job.task_id]
        if progress.status != "failed":
            node = self.nodes[job.node_id]
            if job.kind == "upload":
                progress.upload_start = job.start
                progress.upload_end = job.end
                self._enqueue(self.cpu[job.node_id], _Job("compute", job.task_id, job.node_id, _compute_seconds(progress.compute_cycles, node)), job.end)
            elif job.kind == "compute":
                progress.compute_start = job.start
                progress.compute_end = job.end
                if job.node_id == self.gateway:
                    self._finish_local(progress, node)
                else:
                    self._enqueue(self.channel[job.node_id], _Job("return", job.task_id, job.node_id, _transfer_seconds(progress.return_bytes, node["link_rate_bps"])), job.end)
            elif job.kind == "return":
                progress.return_start = job.start
                progress.return_end = job.end
                self._finish_remote(progress, node)
        self._pump(server, job.end)

    def _finish_local(self, progress: _Progress, node) -> None:
        progress.completion = progress.compute_end
        progress.compute_energy = (progress.compute_end - progress.compute_start) * node["active_compute_power_increment_w"]
        progress.transfer_energy = 0.0
        progress.status = "complete"
        progress.failure_reason = None

    def _finish_remote(self, progress: _Progress, node) -> None:
        progress.completion = progress.return_end
        progress.compute_energy = (progress.compute_end - progress.compute_start) * node["active_compute_power_increment_w"]
        progress.transfer_energy = (progress.upload_bytes + progress.return_bytes) / 1_000_000 * node["transfer_energy_j_per_mb"]
        progress.status = "complete"
        progress.failure_reason = None

    def _fail(self, task_id: str, reason: str) -> None:
        progress = self.progress[task_id]
        if progress.status == "complete":
            return
        progress.status = "failed"
        progress.failure_reason = reason
        progress.completion = None
        progress.compute_energy = None
        progress.transfer_energy = None

    def _event(self, instance, task) -> dict:
        progress = self.progress[task["task_id"]]
        return {
            "schema_version": SCHEMA_VERSION,
            "run_id": None,
            "instance_id": instance["instance_id"],
            "task_id": task["task_id"],
            "destination_id": progress.destination_id,
            "status": progress.status,
            "failure_reason": progress.failure_reason,
            "upload_start_s": progress.upload_start,
            "upload_end_s": progress.upload_end,
            "compute_start_s": progress.compute_start,
            "compute_end_s": progress.compute_end,
            "return_start_s": progress.return_start,
            "return_end_s": progress.return_end,
            "completion_s": progress.completion,
            "compute_energy_j": progress.compute_energy,
            "transfer_energy_j": progress.transfer_energy,
        }


def _server_snapshot(server: _Server, now: float) -> tuple[int, float]:
    """Waiting jobs, excluding the running job, and seconds until the server is idle."""
    remaining = 0.0
    if server.running is not None and server.running.end is not None:
        remaining += max(0.0, server.running.end - now)
    for job in server.queue:
        remaining += job.duration
    return len(server.queue), remaining


def _compute_seconds(cycles, node) -> float:
    capacity = node["compute_capacity_cycles_per_s"]
    if isinstance(capacity, bool) or not isinstance(capacity, (int, float)) or not math.isfinite(capacity) or capacity <= 0:
        raise ValueError(f"Invalid compute capacity on {node['node_id']}")
    return cycles / capacity


def _transfer_seconds(nbytes, rate) -> float:
    return (nbytes * 8) / rate


def run_id_for(instance_id: str, policy_config_id: str, policy_seed: int | None) -> str:
    if policy_seed is None:
        return f"{instance_id}-{policy_config_id}"
    return f"{instance_id}-{policy_config_id}-{policy_seed}"


def summarize_run(instance, events) -> dict:
    """Simulator-owned summary. P3 must recompute M, E, and L from the log."""
    if [event["task_id"] for event in events] != [task["task_id"] for task in instance["tasks"]]:
        raise ValueError("Event order does not match the frozen task list")
    if any(event["status"] != "complete" for event in events):
        reason = next(event["failure_reason"] for event in events if event["status"] != "complete")
        return {"status": "failed", "failure_reason": reason, "makespan_s": None, "energy_j": None, "mean_latency_s": None}
    arrivals = [task["arrival_s"] for task in instance["tasks"]]
    completions = [event["completion_s"] for event in events]
    makespan = max(completions) - min(arrivals)
    latency = sum(completion - arrival for completion, arrival in zip(completions, arrivals)) / len(events)
    energy = sum(event["compute_energy_j"] + event["transfer_energy_j"] for event in events)
    return {"status": "complete", "failure_reason": None, "makespan_s": makespan, "energy_j": energy, "mean_latency_s": latency}


def run_instance(frozen_instance, fixed_policy, manifest, *, event_log_path: str, deadline_s: float | None = None):
    """Run one frozen instance. The task list is not resampled."""
    if frozen_instance["manifest_id"] != manifest["manifest_id"]:
        raise ValueError("Instance manifest_id does not match the manifest")
    events = Simulator(manifest, deadline_s=deadline_s).run(frozen_instance, fixed_policy)
    policy_seed = fixed_policy.policy_seed
    run_id = run_id_for(frozen_instance["instance_id"], fixed_policy.policy_config_id, policy_seed)
    for event in events:
        event["run_id"] = run_id
    summary = summarize_run(frozen_instance, events)
    record = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "instance_id": frozen_instance["instance_id"],
        "manifest_id": manifest["manifest_id"],
        "policy_config_id": fixed_policy.policy_config_id,
        "policy_seed": policy_seed,
        "simulator_version": SIMULATOR_VERSION,
        "dqn_checkpoint_id": None,
        "record_origin": "simulation",
        "status": summary["status"],
        "failure_reason": summary["failure_reason"],
        "task_count": len(frozen_instance["tasks"]),
        "makespan_s": summary["makespan_s"],
        "energy_j": summary["energy_j"],
        "mean_latency_s": summary["mean_latency_s"],
        "event_log_path": event_log_path,
    }
    return events, record
