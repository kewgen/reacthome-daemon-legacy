import asyncio
import json
import os
from typing import Any, Callable, Dict, Iterable, List, Optional, Set

import pytest
import websockets


ACTION_SET = "ACTION_SET"
ACTION_SITE_LIGHT_ON = "ACTION_SITE_LIGHT_ON"
ACTION_SITE_LIGHT_OFF = "ACTION_SITE_LIGHT_OFF"
ACTION_OFF = "ACTION_OFF"


def _is_on(payload: Dict[str, Any]) -> bool:
    value = payload.get("value")
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.lower() not in {"", "0", "false", "off"}
    brightness = payload.get("brightness")
    if isinstance(brightness, (int, float)):
        return brightness > 0
    rgb = tuple(payload.get(k) for k in ("r", "g", "b"))
    if any(isinstance(component, (int, float)) and component > 0 for component in rgb):
        return True
    return False


async def _wait_for_message(
    websocket: websockets.WebSocketClientProtocol,
    predicate: Callable[[Dict[str, Any]], bool],
    timeout: float,
) -> Dict[str, Any]:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise AssertionError("Не дождались ожидаемого сообщения от вебсокета")
        data = json.loads(await asyncio.wait_for(websocket.recv(), remaining))
        if predicate(data):
            return data


async def _collect_updates(
    websocket: websockets.WebSocketClientProtocol,
    targets: Iterable[str],
    predicate: Callable[[Dict[str, Any]], bool],
    min_hits: int,
    timeout: float,
) -> Dict[str, Dict[str, Any]]:
    target_set: Set[str] = set(targets)
    matched: Dict[str, Dict[str, Any]] = {}
    deadline = asyncio.get_running_loop().time() + timeout
    while len(matched) < min_hits:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        message = json.loads(await asyncio.wait_for(websocket.recv(), remaining))
        if message.get("type") != ACTION_SET:
            continue
        message_id = message.get("id")
        if message_id in target_set:
            payload = message.get("payload") or {}
            if predicate(payload):
                matched[message_id] = payload
    return matched


async def _request_site_payload(
    websocket: websockets.WebSocketClientProtocol,
    location_id: str,
    timeout: float,
) -> Dict[str, Any]:
    await websocket.send(json.dumps({"type": "get", "state": [location_id]}))
    response = await _wait_for_message(
        websocket,
        lambda msg: msg.get("type") == ACTION_SET and msg.get("id") == location_id,
        timeout,
    )
    payload = response.get("payload") or {}
    if not payload:
        raise AssertionError(f"Локация {location_id!r} не вернула payload")
    return payload


async def _fetch_initial_states(
    websocket: websockets.WebSocketClientProtocol,
    targets: Iterable[str],
    timeout: float,
) -> Dict[str, Dict[str, Any]]:
    target_list: List[str] = list(targets)
    if not target_list:
        return {}
    await websocket.send(json.dumps({"type": "get", "state": target_list}))
    updates = await _collect_updates(
        websocket,
        target_list,
        predicate=lambda payload: True,
        min_hits=len(target_list),
        timeout=timeout,
    )
    if len(updates) != len(target_list):
        missing = sorted(set(target_list) - set(updates))
        raise AssertionError(f"Не получили исходные состояния для каналов: {missing}")
    return updates


async def _restore_state(
    websocket: websockets.WebSocketClientProtocol,
    initial_state: Dict[str, Dict[str, Any]],
    timeout: float,
) -> None:
    ids_to_restore = [
        channel_id
        for channel_id, payload in initial_state.items()
        if not _is_on(payload)
    ]
    if not ids_to_restore:
        return
    for channel_id in ids_to_restore:
        await websocket.send(json.dumps({"type": ACTION_OFF, "id": channel_id}))
    restored = await _collect_updates(
        websocket,
        ids_to_restore,
        predicate=lambda payload: not _is_on(payload),
        min_hits=len(ids_to_restore),
        timeout=timeout,
    )
    if len(restored) != len(ids_to_restore):
        missing = sorted(set(ids_to_restore) - set(restored))
        raise AssertionError(f"Не удалось вернуть каналы в исходное состояние: {missing}")


@pytest.mark.integration
@pytest.mark.asyncio
async def test_lodgia_lighting_can_be_switched_on_and_restored() -> None:
    server_uri = os.getenv("REACTHOME_WS_URI", "ws://192.168.0.3:3000")
    location_id = os.getenv("REACTHOME_LOCATION_ID", "Лоджия")
    timeout = float(os.getenv("REACTHOME_WS_TIMEOUT", "10"))

    async with websockets.connect(server_uri) as websocket:
        site_payload = await _request_site_payload(websocket, location_id, timeout)
        light_targets: List[str] = []
        for key in ("light_220", "light_LED", "light_RGB"):
            channels: Optional[List[str]] = site_payload.get(key)
            if channels:
                light_targets.extend(channels)

        assert light_targets, f"В локации {location_id!r} не найдены каналы освещения"

        initial_states = await _fetch_initial_states(websocket, light_targets, timeout)

        await websocket.send(
            json.dumps({"type": ACTION_SITE_LIGHT_ON, "id": location_id})
        )

        updates = await _collect_updates(
            websocket,
            light_targets,
            predicate=_is_on,
            min_hits=1,
            timeout=timeout,
        )
        assert updates, "Не получили подтверждения включения освещения"

        await _restore_state(websocket, initial_states, timeout)

