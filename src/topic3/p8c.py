"""Two-episode feasibility run for the provisional DQN.

The recorded greedy choose path is not used for these actions. A training
wrapper draws epsilon-greedy actions from the seed stream and does not update
weights. After a complete episode, placement credits from the reward ledger
become one transition per task, and train_step updates the online network.
The target network is left unchanged. Held-out instances are not read.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path

from topic3.dqn import (
    GAMMA,
    LEARNING_RATE,
    PROVISIONAL_DQN_SEED,
    DqnPolicy,
    copy_weights,
    epsilon_greedy_index,
    feature_vector,
    forward,
)
from topic3.metrics import recompute_objectives
from topic3.reward_ledger import build_ledger, complete_run_reward
from topic3.simulator import SIMULATOR_VERSION, run_instance

INSTANCE_ID = "provisional-training-low-1000"
EPISODE_COUNT = 2
EPSILON = 0.1
TOLERANCE = 1e-9


class EpsilonGreedyTrainer:
    """choose selects an exploratory action. It does not update weights."""

    epsilon = EPSILON

    def __init__(self, policy: DqnPolicy):
        self.policy = policy
        self.policy_config_id = policy.policy_config_id
        self.policy_seed = policy.policy_seed
        self.decisions = []

    def choose(self, task, observable_state) -> str:
        vector = feature_vector(observable_state, self.policy.feature_config, self.policy.destination_ids)
        q_values, _cache = forward(self.policy.online, vector)
        self.policy.rng_state, action, explored = epsilon_greedy_index(q_values, self.epsilon, self.policy.rng_state)
        self.decisions.append({
            "task_id": task["task_id"],
            "state": vector,
            "action": action,
            "explored": explored,
        })
        return self.policy.destination_ids[action]


def run_p8c(root: Path) -> dict:
    """Run the two authorized episodes and return the feasibility record."""
    if "held_out" in INSTANCE_ID:
        raise ValueError("P8c cannot read a held-out instance")
    manifest = json.loads((root / "configs" / "provisional" / "training.json").read_text(encoding="utf-8"))
    frozen = json.loads((root / "artifacts" / "workloads" / "provisional" / "training" / f"{INSTANCE_ID}.json").read_text(encoding="utf-8"))
    if frozen.get("instance_id") != INSTANCE_ID or frozen.get("phase") != "training":
        raise ValueError("P8c requires the named training instance")
    feature_config = json.loads((root / "configs" / "provisional" / "dqn_features.json").read_text(encoding="utf-8"))
    if feature_config.get("held_out_used") is not False:
        raise ValueError("P8c refused feature scales that used held-out runs")
    destinations = [node["node_id"] for node in manifest["topology"]["nodes"]]
    policy = DqnPolicy(destinations, feature_config)
    trainer = EpsilonGreedyTrainer(policy)
    online_before = copy_weights(policy.online)
    target_before = copy_weights(policy.target)
    episodes = []
    started = time.perf_counter()
    run_status = "complete"
    for episode_index in range(1, EPISODE_COUNT + 1):
        episode, failed = _run_episode(episode_index, trainer, frozen, manifest, feature_config)
        episodes.append(episode)
        if failed:
            run_status = "failed"
            break
    elapsed = time.perf_counter() - started
    return {
        "schema_version": "1.0.0",
        "status": "provisional_not_frozen",
        "run_status": run_status,
        "held_out_used": False,
        "checkpoint_id": None,
        "instance_id": INSTANCE_ID,
        "seed": PROVISIONAL_DQN_SEED,
        "epsilon": EPSILON,
        "gamma": GAMMA,
        "learning_rate": LEARNING_RATE,
        "episode_count_requested": EPISODE_COUNT,
        "episodes_completed": sum(1 for episode in episodes if episode["status"] == "complete"),
        "simulator_version": SIMULATOR_VERSION,
        "s_M": feature_config["s_M"],
        "s_E": feature_config["s_E"],
        "s_L": feature_config["s_L"],
        "target_synced": False,
        "online_weights_changed": policy.online != online_before,
        "target_weights_unchanged": policy.target == target_before,
        "total_elapsed_s": elapsed,
        "episodes": episodes,
        "note": "Two epsilon-greedy episodes on one training instance. Placement credits are summed onto the decision that placed the task. choose remains greedy and was not used for these actions. No checkpoint and no held-out inference.",
    }


def _run_episode(episode_index, trainer, frozen, manifest, scales):
    trainer.decisions = []
    online_before = copy_weights(trainer.policy.online)
    started = time.perf_counter()
    events, record = run_instance(frozen, trainer, manifest, event_log_path=f"p8c-episode-{episode_index}.jsonl")
    if trainer.policy.online != online_before:
        raise RuntimeError("Epsilon-greedy choose updated online weights")
    failure = _placement_failure(record, events, trainer.policy.destination_ids)
    elapsed = time.perf_counter() - started
    if failure is not None:
        return _failed_episode(episode_index, failure, record, elapsed), True
    objectives = recompute_objectives(frozen, events, local_node_id=manifest["topology"]["gateway_node_id"])
    ledger = build_ledger(frozen, events, scales)
    reward = complete_run_reward(objectives, scales)
    if abs(ledger["total"] - reward) > TOLERANCE:
        return _failed_episode(episode_index, "ledger total disagrees with independent R", record, elapsed), True
    transitions = _transitions(trainer.decisions, ledger, frozen)
    reward_sum = sum(item["reward"] for item in transitions)
    if abs(reward_sum - ledger["total"]) > TOLERANCE:
        return _failed_episode(episode_index, "transition rewards disagree with the ledger", record, elapsed), True
    loss = trainer.policy.train_step(transitions)
    counts = {destination: 0 for destination in trainer.policy.destination_ids}
    for event in events:
        counts[event["destination_id"]] += 1
    return {
        "episode": episode_index,
        "status": "complete",
        "failure_reason": None,
        "task_count": len(frozen["tasks"]),
        "makespan_s": objectives["makespan_s"],
        "energy_j": objectives["energy_j"],
        "mean_latency_s": objectives["mean_latency_s"],
        "ledger_total": ledger["total"],
        "independent_R": reward,
        "component_totals": ledger["component_totals"],
        "transition_reward_sum": reward_sum,
        "destination_counts": counts,
        "explore_draws": sum(1 for decision in trainer.decisions if decision["explored"]),
        "loss_before_update": loss,
        "weight_update": True,
        "elapsed_s": elapsed,
    }, False


def _transitions(decisions, ledger, frozen):
    expected = [task["task_id"] for task in frozen["tasks"]]
    if [decision["task_id"] for decision in decisions] != expected:
        raise ValueError("Placement order does not match the frozen task list")
    rewards = {task_id: 0.0 for task_id in expected}
    for entry in ledger["entries"]:
        rewards[entry["task_id"]] += entry["amount"]
    transitions = []
    for index, decision in enumerate(decisions):
        done = index == len(decisions) - 1
        transition = {
            "state": decision["state"],
            "action": decision["action"],
            "reward": rewards[decision["task_id"]],
            "done": done,
        }
        if not done:
            transition["next_state"] = decisions[index + 1]["state"]
        transitions.append(transition)
    return transitions


def _placement_failure(record, events, destinations):
    allowed = set(destinations)
    if record["status"] != "complete":
        return record["failure_reason"] or "run did not complete"
    for event in events:
        if event["destination_id"] not in allowed:
            return f"destination outside the four nodes: {event['destination_id']}"
        if event["status"] != "complete":
            return event["failure_reason"] or f"task did not complete: {event['task_id']}"
    return None


def _failed_episode(episode_index, reason, record, elapsed):
    return {
        "episode": episode_index,
        "status": "failed",
        "failure_reason": reason,
        "task_count": record.get("task_count"),
        "makespan_s": None,
        "energy_j": None,
        "mean_latency_s": None,
        "ledger_total": None,
        "independent_R": None,
        "weight_update": False,
        "elapsed_s": elapsed,
    }


def ledger_matches(episode) -> bool:
    return math.isclose(episode["ledger_total"], episode["independent_R"], rel_tol=0.0, abs_tol=TOLERANCE)
