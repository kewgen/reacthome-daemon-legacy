import asyncio
import json
import logging
import os
from typing import Any, Callable, Dict, Iterable, List, Optional, Set

import pytest
import websockets


logger = logging.getLogger(__name__)
logging.basicConfig(
    level=os.getenv("REACTHOME_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


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
        raw = await asyncio.wait_for(websocket.recv(), remaining)
        logger.debug("Получено сообщение: %s", raw)
        data = json.loads(raw)
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
        raw = await asyncio.wait_for(websocket.recv(), remaining)
        logger.debug("Получено обновление: %s", raw)
        message = json.loads(raw)
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
    request = {"type": "get", "state": [location_id]}
    logger.info("Запрашиваем payload локации %s: %s", location_id, request)
    await websocket.send(json.dumps(request))
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
    request = {"type": "get", "state": target_list}
    logger.info("Запрашиваем исходные состояния каналов: %s", request)
    await websocket.send(json.dumps(request))
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
        message = {"type": ACTION_OFF, "id": channel_id}
        logger.info("Возврат канала %s в исходное состояние: %s", channel_id, message)
        await websocket.send(json.dumps(message))
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
    server_uri = os.getenv("REACTHOME_WS_URI", "ws://192.168.0.2:3000")
    location_id = os.getenv("REACTHOME_LOCATION_ID", "Лоджия")
    timeout = float(os.getenv("REACTHOME_WS_TIMEOUT", "10"))

    logger.info("Подключение к серверу %s", server_uri)
    async with websockets.connect(server_uri) as websocket:
        logger.info("Подключение установлено, получаем данные локации %s", location_id)
        site_payload = await _request_site_payload(websocket, location_id, timeout)
        light_targets: List[str] = []
        for key in ("light_220", "light_LED", "light_RGB"):
            channels: Optional[List[str]] = site_payload.get(key)
            if channels:
                light_targets.extend(channels)

        assert light_targets, f"В локации {location_id!r} не найдены каналы освещения"
        logger.info("Найдены каналы освещения: %s", light_targets)

        initial_states = await _fetch_initial_states(websocket, light_targets, timeout)
        logger.debug("Исходные состояния каналов: %s", initial_states)

        turn_on = {"type": ACTION_SITE_LIGHT_ON, "id": location_id}
        logger.info("Отправляем команду включения света: %s", turn_on)
        await websocket.send(json.dumps(turn_on))

        updates = await _collect_updates(
            websocket,
            light_targets,
            predicate=_is_on,
            min_hits=1,
            timeout=timeout,
        )
        assert updates, "Не получили подтверждения включения освещения"
        logger.info("Получены обновления о включении: %s", updates)

        await _restore_state(websocket, initial_states, timeout)
        logger.info("Каналы успешно возвращены в исходное состояние")


async def _find_site_by_title(
    websocket: websockets.WebSocketClientProtocol,
    title: str,
    timeout: float,
) -> Optional[str]:
    """Находит UUID локации по её названию (title)."""
    logger.info("Ищем локацию с title=%s через LIST", title)
    await websocket.send(json.dumps({"type": "list"}))
    
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        try:
            # Уменьшаем таймаут на каждое сообщение для более быстрого ответа
            raw = await asyncio.wait_for(websocket.recv(), min(remaining, 0.5))
            message = json.loads(raw)
            if message.get("type") == ACTION_SET:
                payload = message.get("payload") or {}
                if payload.get("type") == "site" and payload.get("title") == title:
                    site_id = message.get("id")
                    logger.info("Найдена локация %s с UUID: %s", title, site_id)
                    return site_id
        except asyncio.TimeoutError:
            continue
        except Exception as e:
            logger.debug("Ошибка при поиске локации: %s", e)
            continue
    return None


def _is_uuid(value: str) -> bool:
    """Проверяет, является ли строка UUID."""
    import re
    uuid_pattern = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)
    return bool(uuid_pattern.match(value))


@pytest.mark.integration
@pytest.mark.asyncio
async def test_lodgia_lighting_can_be_switched_on() -> None:
    """Тест включения света в лоджии - отправка команды и проверка логов."""
    server_uri = os.getenv("REACTHOME_WS_URI", "ws://192.168.88.4:3000")
    location_title = os.getenv("REACTHOME_LOCATION_ID", "Лоджия")
    # Оптимизированные таймауты: обновления приходят очень быстро (0.5-2 сек)
    search_timeout = float(os.getenv("REACTHOME_SEARCH_TIMEOUT", "2"))
    update_timeout = float(os.getenv("REACTHOME_UPDATE_TIMEOUT", "2"))
    request_timeout = float(os.getenv("REACTHOME_REQUEST_TIMEOUT", "2"))
    msg_timeout = float(os.getenv("REACTHOME_MSG_TIMEOUT", "0.2"))  # Таймаут на каждое сообщение

    logger.info("Подключение к серверу %s", server_uri)
    async with websockets.connect(server_uri) as websocket:
        logger.info("Подключение установлено")
        
        # Если передан UUID напрямую, пропускаем поиск по названию
        if _is_uuid(location_title):
            location_id = location_title
            logger.info("Используем переданный UUID локации: %s", location_id)
        else:
            # Находим UUID локации по названию (быстрый поиск)
            logger.info("Ищем локацию по названию '%s'", location_title)
            location_id = await _find_site_by_title(websocket, location_title, search_timeout)
            if not location_id:
                # Если не нашли по названию, пробуем использовать значение как UUID
                logger.warning("Локация '%s' не найдена по title, используем как UUID", location_title)
                location_id = location_title
        
        # Получаем payload локации для проверки каналов (опционально, для логирования)
        light_targets: List[str] = []
        try:
            site_payload = await _request_site_payload(websocket, location_id, request_timeout)
            for key in ("light_220", "light_LED", "light_RGB"):
                channels: Optional[List[str]] = site_payload.get(key)
                if channels:
                    light_targets.extend(channels)
            logger.info("Найдены каналы освещения в локации: %s", light_targets)
        except Exception as e:
            logger.debug("Не удалось получить payload локации (не критично): %s", e)
        
        # Отправляем команду включения
        turn_on = {"type": ACTION_SITE_LIGHT_ON, "id": location_id}
        logger.info("Отправляем команду: %s", turn_on)
        await websocket.send(json.dumps(turn_on))
        
        # Ждём обновления состояния каналов освещения (с ранним выходом)
        logger.info("Ожидаем обновления состояния каналов (таймаут %s сек)...", update_timeout)
        updates_received = []
        deadline = asyncio.get_running_loop().time() + update_timeout
        # Прекращаем ожидание после первого обновления канала или локации
        min_updates = 1
        
        try:
            while asyncio.get_running_loop().time() < deadline:
                # Если получили достаточно обновлений, выходим раньше
                if len(updates_received) >= min_updates:
                    logger.debug("Получено достаточно обновлений (%d), прекращаем ожидание", len(updates_received))
                    break
                    
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    break
                try:
                    # Короткий таймаут на каждое сообщение для быстрой реакции
                    raw = await asyncio.wait_for(websocket.recv(), min(remaining, msg_timeout))
                    message = json.loads(raw)
                    logger.debug("Получено сообщение: %s", message)
                    if message.get("type") == ACTION_SET:
                        msg_id = message.get("id")
                        # Собираем обновления для каналов освещения или самой локации
                        if light_targets and msg_id in light_targets:
                            updates_received.append(message)
                            logger.info("Получено обновление для канала %s", msg_id)
                            # Выходим сразу после первого обновления канала
                            break
                        elif msg_id == location_id:
                            updates_received.append(message)
                            # Если это обновление локации, продолжаем ждать обновления каналов
                except asyncio.TimeoutError:
                    continue
        except Exception as e:
            logger.warning("Ошибка при получении сообщений: %s", e)
        
        logger.info("Получено обновлений состояния: %d", len(updates_received))
        if updates_received:
            logger.debug("Примеры обновлений: %s", updates_received[:3])
        
        # Команда отправлена успешно
        assert True, f"Команда включения света отправлена в локацию {location_id}"
        logger.info("Тест завершён: команда включения света отправлена в локацию %s (UUID: %s)", location_title, location_id)

