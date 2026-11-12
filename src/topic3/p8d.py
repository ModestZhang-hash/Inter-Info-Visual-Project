"""Provisional 500-episode DQN training on the three training instances.

Instances cycle low, medium, high. Each completed episode updates the online
network and then copies it to the target. The archived checkpoint is the
online weights after episode 500. Intermediate weights are not compared.
Pilot and held-out instances are not opened.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from topic3.dqn import GAMMA, LEARNING_RATE, PROVISIONAL_DQN_SEED, POLICY_CONFIG_ID, DqnPolicy
from topic3.p8c import EPSILON, EpsilonGreedyTrainer, _run_episode
from topic3.simulator import SIMULATOR_VERSION

TRAINING_INSTANCE_IDS = (
    "provisional-training-low-1000",
    "provisional-training-medium-1001",
    "provisional-training-high-1002",
)
EPISODE_COUNT = 500
CHECKPOINT_ID = "provisional-dqn-seed8-episode500"
SYNC_RULE = "After each episode train_step, copy online weights to the target network."


def training_instance_id(episode_index: int) -> str:
    if isinstance(episode_index, bool) or not isinstance(episode_index, int):
        raise ValueError("Episode index must be an integer")
    if episode_index < 1 or episode_index > EPISODE_COUNT:
        raise ValueError("Episode is outside the provisional 500-episode run")
    instance_id = TRAINING_INSTANCE_IDS[(episode_index - 1) % len(TRAINING_INSTANCE_IDS)]
    if "held_out" in instance_id or "pilot" in instance_id:
        raise ValueError("P8d training cannot use pilot or held-out instances")
    return instance_id


def run_p8d(root: Path) -> tuple[dict, dict | None]:
    """Train once and return the run record plus the final checkpoint, if complete."""
    for instance_id in TRAINING_INSTANCE_IDS:
        if "held_out" in instance_id or "pilot" in instance_id:
            raise ValueError("P8d training cannot use pilot or held-out instances")
    manifest = json.loads((root / "configs" / "provisional" / "training.json").read_text(encoding="utf-8"))
    feature_config = json.loads((root / "configs" / "provisional" / "dqn_features.json").read_text(encoding="utf-8"))
    if feature_config.get("held_out_used") is not False:
        raise ValueError("P8d refused feature scales that used held-out runs")
    instances = {}
    for instance_id in TRAINING_INSTANCE_IDS:
        path = root / "artifacts" / "workloads" / "provisional" / "training" / f"{instance_id}.json"
        frozen = json.loads(path.read_text(encoding="utf-8"))
        if frozen.get("instance_id") != instance_id or frozen.get("phase") != "training":
            raise ValueError(f"P8d refused instance {instance_id}")
        instances[instance_id] = frozen
    destinations = [node["node_id"] for node in manifest["topology"]["nodes"]]
    policy = DqnPolicy(destinations, feature_config)
    trainer = EpsilonGreedyTrainer(policy)
    episodes = []
    run_status = "complete"
    started = time.perf_counter()
    for episode_index in range(1, EPISODE_COUNT + 1):
        instance_id = training_instance_id(episode_index)
        episode, failed = _run_episode(episode_index, trainer, instances[instance_id], manifest, feature_config)
        episode["instance_id"] = instance_id
        if failed:
            episode["target_synced_after_update"] = False
            episodes.append(episode)
            run_status = "failed"
            break
        trainer.policy.sync_target()
        episode["target_synced_after_update"] = True
        episodes.append(episode)
        if episode_index == 1 or episode_index % 50 == 0:
            print(
                f"episode {episode_index} {instance_id} M={episode['makespan_s']:.4f} "
                f"E={episode['energy_j']:.4f} L={episode['mean_latency_s']:.4f}",
                flush=True,
            )
    elapsed = time.perf_counter() - started
    complete = run_status == "complete" and len(episodes) == EPISODE_COUNT
    checkpoint = None
    if complete:
        if policy.target != policy.online:
            raise RuntimeError("Target network does not match the final online weights")
        checkpoint = {
            "schema_version": "1.0.0",
            "status": "provisional_not_frozen",
            "checkpoint_id": CHECKPOINT_ID,
            "policy_config_id": POLICY_CONFIG_ID,
            "seed": PROVISIONAL_DQN_SEED,
            "episode": EPISODE_COUNT,
            "held_out_used": False,
            "for_held_out_inference": False,
            "weights": policy.online,
        }
    record = {
        "schema_version": "1.0.0",
        "status": "provisional_not_frozen",
        "run_status": run_status,
        "held_out_used": False,
        "for_held_out_inference": False,
        "checkpoint_id": None if checkpoint is None else CHECKPOINT_ID,
        "checkpoint_rule": "Archive the online weights after episode 500. Intermediate checkpoints were not compared or selected.",
        "target_sync_rule": SYNC_RULE,
        "seed": PROVISIONAL_DQN_SEED,
        "epsilon": EPSILON,
        "gamma": GAMMA,
        "learning_rate": LEARNING_RATE,
        "episode_count_requested": EPISODE_COUNT,
        "episodes_completed": sum(1 for episode in episodes if episode["status"] == "complete"),
        "instance_cycle": list(TRAINING_INSTANCE_IDS),
        "simulator_version": SIMULATOR_VERSION,
        "s_M": feature_config["s_M"],
        "s_E": feature_config["s_E"],
        "s_L": feature_config["s_L"],
        "target_matches_final_online": complete,
        "total_elapsed_s": elapsed,
        "episodes": episodes,
        "note": "One provisional training run. The checkpoint is not a held-out policy and was not chosen by pilot or held-out results.",
    }
    return record, checkpoint
