"""Provisional pure-Python DQN on the shared choose interface.

Two ReLU hidden layers of 64 units and four linear action values. Inference
is greedy and keeps the earliest action on a tie. choose does not draw from
the seed or change weights. train_step and train_from_replay are the only
updates. One recorded seed initializes the weights; the same stream then
serves replay sampling. Gamma is 1. This is not a design freeze, a checkpoint,
or a held-out policy.
"""

from __future__ import annotations

import math

from topic3.features import normalize_decision_features
from topic3.workload import _uniform_int, _unit_interval

PROVISIONAL_DQN_SEED = 8
POLICY_CONFIG_ID = "dqn-fixed"
HIDDEN_UNITS = (64, 64)
ACTION_COUNT = 4
INPUT_SIZE = 27
LEARNING_RATE = 0.001
GAMMA = 1
REPLAY_CAPACITY = 1024
FEATURE_NAMES = (
    "compute_cycles_normalized",
    "upload_bytes_normalized",
    "return_bytes_normalized",
    "cpu_queue_length",
    "channel_queue_length",
    "cpu_remaining_busy_normalized",
    "channel_remaining_busy_normalized",
    "projected_completion_normalized",
    "projected_task_energy_normalized",
)


class ReplayBuffer:
    """Fixed ring of transitions. Sampling is supplied by the caller."""

    def __init__(self, capacity: int = REPLAY_CAPACITY):
        if isinstance(capacity, bool) or not isinstance(capacity, int) or capacity <= 0:
            raise ValueError("Replay capacity must be a positive integer")
        self.capacity = capacity
        self.rows = []
        self.next = 0

    def __len__(self) -> int:
        return len(self.rows)

    def add(self, transition: dict) -> None:
        row = dict(transition)
        if len(self.rows) < self.capacity:
            self.rows.append(row)
        else:
            self.rows[self.next] = row
        self.next = (self.next + 1) % self.capacity


class DqnPolicy:
    """Greedy dqn-fixed policy. Weight updates happen only in training methods."""

    policy_config_id = POLICY_CONFIG_ID
    family = "dqn"
    policy_seed = PROVISIONAL_DQN_SEED

    def __init__(self, destination_ids, feature_config):
        if len(destination_ids) != ACTION_COUNT:
            raise ValueError("DQN requires the four manifest destinations")
        if len(set(destination_ids)) != ACTION_COUNT:
            raise ValueError("DQN destinations must be unique")
        self.destination_ids = list(destination_ids)
        self.feature_config = feature_config
        self.learning_rate = LEARNING_RATE
        self.gamma = GAMMA
        self.online, rng_state = _initial_weights(PROVISIONAL_DQN_SEED)
        self.target = copy_weights(self.online)
        self.rng_state = rng_state
        self.replay = ReplayBuffer(REPLAY_CAPACITY)

    def choose(self, task, observable_state) -> str:
        """Return one destination. Weights, replay, and the seed stream stay unchanged."""
        del task
        vector = feature_vector(observable_state, self.feature_config, self.destination_ids)
        q_values, _cache = forward(self.online, vector)
        return self.destination_ids[greedy_index(q_values)]

    def remember(self, transition: dict) -> None:
        self.replay.add(_checked_transition(transition))

    def train_step(self, transitions) -> float:
        """One SGD step on an explicit batch. This is the online-weight update."""
        if isinstance(transitions, dict):
            transitions = [transitions]
        if not transitions:
            raise ValueError("Training step requires at least one transition")
        checked = [_checked_transition(item) for item in transitions]
        loss, gradients = loss_and_gradients(self.online, self.target, checked, self.gamma)
        _sgd(self.online, gradients, self.learning_rate)
        return loss

    def train_from_replay(self, batch_size: int) -> float:
        """Sample with the recorded seed stream, then update online weights."""
        if isinstance(batch_size, bool) or not isinstance(batch_size, int) or batch_size <= 0:
            raise ValueError("Replay batch size must be a positive integer")
        self.rng_state, batch = sample_replay(self.replay, batch_size, self.rng_state)
        return self.train_step(batch)

    def sync_target(self) -> None:
        """Copy online weights onto the target network."""
        self.target = copy_weights(self.online)


def feature_vector(observable_state, feature_config, destination_ids) -> list[float]:
    """Twenty-seven values: three task features, then six features for each destination."""
    raw = observable_state.get("decision_features")
    if not isinstance(raw, dict) or "nodes" not in raw:
        raise ValueError("DQN requires decision_features")
    node_ids = [node.get("node_id") for node in raw["nodes"]]
    if node_ids != list(destination_ids):
        raise ValueError("Feature node order does not match destination_ids")
    normalized = normalize_decision_features(raw, feature_config)
    values = [
        normalized["compute_cycles_normalized"],
        normalized["upload_bytes_normalized"],
        normalized["return_bytes_normalized"],
    ]
    per_node = FEATURE_NAMES[3:]
    for node in normalized["nodes"]:
        for name in per_node:
            value = node[name]
            if value is None or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"DQN feature is missing: {name}")
            values.append(float(value))
    if len(values) != INPUT_SIZE:
        raise ValueError("DQN feature vector has the wrong length")
    return values


def greedy_index(q_values) -> int:
    """Lowest index wins a tie, which is manifest destination order."""
    best = 0
    best_q = q_values[0]
    for index in range(1, len(q_values)):
        if q_values[index] > best_q:
            best = index
            best_q = q_values[index]
    return best


def epsilon_greedy_index(q_values, epsilon, rng_state: int):
    """Training-time action. Advances the seed stream and does not change weights."""
    if isinstance(epsilon, bool) or not isinstance(epsilon, (int, float)) or not 0.0 <= float(epsilon) <= 1.0:
        raise ValueError("epsilon must be between 0 and 1")
    rng_state, draw = _unit_interval(rng_state)
    if draw < float(epsilon):
        rng_state, index = _uniform_int(rng_state, 0, len(q_values) - 1)
        return rng_state, index, True
    return rng_state, greedy_index(q_values), False


def forward(weights, vector):
    if len(vector) != len(weights["W1"][0]):
        raise ValueError("Feature vector length does not match the network")
    z1 = _affine(weights["W1"], vector, weights["b1"])
    h1 = _relu(z1)
    z2 = _affine(weights["W2"], h1, weights["b2"])
    h2 = _relu(z2)
    q_values = _affine(weights["W3"], h2, weights["b3"])
    return q_values, (vector, z1, h1, z2, h2, weights)


def loss_and_gradients(online, target, transitions, gamma):
    """Mean of 0.5 * (Q(s,a) - y)^2. y uses the target network when the step continues."""
    if gamma != GAMMA:
        raise ValueError("Provisional DQN discount is gamma = 1")
    batch = len(transitions)
    gradients = _zero_like(online)
    total = 0.0
    for transition in transitions:
        q_values, cache = forward(online, transition["state"])
        action = transition["action"]
        target_value = _td_target(target, transition, gamma)
        residual = q_values[action] - target_value
        total += 0.5 * residual * residual
        _accumulate(gradients, cache, action, residual / batch)
    return total / batch, gradients


def copy_weights(weights) -> dict:
    return {
        "W1": [row[:] for row in weights["W1"]],
        "b1": weights["b1"][:],
        "W2": [row[:] for row in weights["W2"]],
        "b2": weights["b2"][:],
        "W3": [row[:] for row in weights["W3"]],
        "b3": weights["b3"][:],
    }


def sample_replay(buffer: ReplayBuffer, count: int, state: int):
    if count > len(buffer):
        raise ValueError("Replay sample is larger than the buffer")
    picked = []
    used = set()
    while len(picked) < count:
        state, index = _uniform_int(state, 0, len(buffer) - 1)
        if index in used:
            continue
        used.add(index)
        picked.append(dict(buffer.rows[index]))
    return state, picked


def _initial_weights(seed: int):
    state = seed
    state, w1 = _he_matrix(state, HIDDEN_UNITS[0], INPUT_SIZE)
    state, w2 = _he_matrix(state, HIDDEN_UNITS[1], HIDDEN_UNITS[0])
    state, w3 = _he_matrix(state, ACTION_COUNT, HIDDEN_UNITS[1])
    weights = {
        "W1": w1,
        "b1": [0.0] * HIDDEN_UNITS[0],
        "W2": w2,
        "b2": [0.0] * HIDDEN_UNITS[1],
        "W3": w3,
        "b3": [0.0] * ACTION_COUNT,
    }
    return weights, state


def _he_matrix(state: int, rows: int, cols: int):
    scale = math.sqrt(2.0 / cols)
    matrix = []
    for _row in range(rows):
        values = []
        for _col in range(cols):
            state, normal = _standard_normal(state)
            values.append(normal * scale)
        matrix.append(values)
    return state, matrix


def _standard_normal(state: int):
    state, first = _unit_interval(state)
    state, second = _unit_interval(state)
    radius = math.sqrt(-2.0 * math.log(first))
    return state, radius * math.cos(2.0 * math.pi * second)


def _affine(matrix, vector, bias):
    output = []
    for row, offset in zip(matrix, bias):
        total = offset
        for weight, value in zip(row, vector):
            total += weight * value
        output.append(total)
    return output


def _relu(values):
    return [value if value > 0.0 else 0.0 for value in values]


def _td_target(target, transition, gamma):
    if transition["done"]:
        return float(transition["reward"])
    next_q, _cache = forward(target, transition["next_state"])
    return float(transition["reward"]) + gamma * max(next_q)


def _accumulate(gradients, cache, action, signal):
    vector, z1, h1, z2, h2, weights = cache
    for index, activation in enumerate(h2):
        gradients["W3"][action][index] += signal * activation
    gradients["b3"][action] += signal
    hidden_grad = [signal * weights["W3"][action][index] for index in range(len(h2))]
    second = [hidden_grad[index] * (1.0 if z2[index] > 0.0 else 0.0) for index in range(len(h2))]
    first_grad = [0.0] * len(h1)
    for row, upstream in enumerate(second):
        gradients["b2"][row] += upstream
        for column, activation in enumerate(h1):
            gradients["W2"][row][column] += upstream * activation
            first_grad[column] += upstream * weights["W2"][row][column]
    first = [first_grad[index] * (1.0 if z1[index] > 0.0 else 0.0) for index in range(len(h1))]
    for row, upstream in enumerate(first):
        gradients["b1"][row] += upstream
        for column, value in enumerate(vector):
            gradients["W1"][row][column] += upstream * value


def _sgd(weights, gradients, learning_rate):
    for key in ("W1", "W2", "W3"):
        for row, grad_row in zip(weights[key], gradients[key]):
            for index, grad in enumerate(grad_row):
                row[index] -= learning_rate * grad
    for key in ("b1", "b2", "b3"):
        bias = weights[key]
        for index, grad in enumerate(gradients[key]):
            bias[index] -= learning_rate * grad


def _zero_like(weights):
    return {
        "W1": [[0.0] * len(weights["W1"][0]) for _row in weights["W1"]],
        "b1": [0.0] * len(weights["b1"]),
        "W2": [[0.0] * len(weights["W2"][0]) for _row in weights["W2"]],
        "b2": [0.0] * len(weights["b2"]),
        "W3": [[0.0] * len(weights["W3"][0]) for _row in weights["W3"]],
        "b3": [0.0] * len(weights["b3"]),
    }


def _checked_transition(transition: dict) -> dict:
    state = _vector(transition.get("state"), "state")
    action = transition.get("action")
    if isinstance(action, bool) or not isinstance(action, int) or not 0 <= action < ACTION_COUNT:
        raise ValueError("DQN action must be an integer destination index")
    reward = transition.get("reward")
    if isinstance(reward, bool) or not isinstance(reward, (int, float)) or not math.isfinite(reward):
        raise ValueError("DQN reward must be finite")
    done = transition.get("done")
    if not isinstance(done, bool):
        raise ValueError("DQN done flag must be boolean")
    checked = {"state": state, "action": action, "reward": float(reward), "done": done}
    if done:
        checked["next_state"] = None
        return checked
    checked["next_state"] = _vector(transition.get("next_state"), "next_state")
    return checked


def _vector(values, label: str) -> list[float]:
    if not isinstance(values, list) or len(values) != INPUT_SIZE:
        raise ValueError(f"DQN {label} must contain {INPUT_SIZE} features")
    vector = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"DQN {label} must be finite")
        vector.append(float(value))
    return vector
