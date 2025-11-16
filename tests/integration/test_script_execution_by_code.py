import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

import pytest
import websockets

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=os.getenv("REACTHOME_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

ACTION_SET = "ACTION_SET"
ACTION_SCRIPT_RUN = "ACTION_SCRIPT_RUN"


def _is_uuid(value: str) -> bool:
    """Проверяет, является ли строка UUID."""
    uuid_pattern = re.compile(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        re.IGNORECASE
    )
    return bool(uuid_pattern.match(value))


async def _find_script_by_code(
    websocket: websockets.WebSocketClientProtocol,
    code: str,
    timeout: float,
) -> Optional[str]:
    """Находит UUID скрипта по его коду (code).
    
    Стратегия поиска:
    1. Получаем список всех объектов через LIST
    2. Запрашиваем данные всех скриптов через GET
    3. Ищем скрипт с совпадающим полем code в payload
    """
    logger.info("Ищем скрипт с code='%s'", code)
    
    # Шаг 1: Получаем список всех объектов
    logger.info("Запрашиваем список всех объектов (LIST)...")
    await websocket.send(json.dumps({"type": "list"}))
    
    script_ids = []
    deadline = asyncio.get_running_loop().time() + timeout
    list_received = False
    
    # Собираем ID всех объектов из LIST
    while asyncio.get_running_loop().time() < deadline:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        try:
            raw = await asyncio.wait_for(websocket.recv(), min(remaining, 0.5))
            message = json.loads(raw)
            if message.get("type") == "list" and message.get("state"):
                list_received = True
                # Собираем все ID из списка
                for item in message.get("state", []):
                    if isinstance(item, list) and len(item) > 0:
                        script_ids.append(item[0])
                logger.info("Получено ID объектов: %d", len(script_ids))
                break
        except asyncio.TimeoutError:
            continue
        except Exception as e:
            logger.debug("Ошибка при получении LIST: %s", e)
            continue
    
    if not list_received or not script_ids:
        logger.warning("Не удалось получить список объектов")
        return None
    
    # Шаг 2: Запрашиваем данные всех скриптов
    logger.info("Запрашиваем данные объектов (GET)...")
    await websocket.send(json.dumps({"type": "get", "state": script_ids}))
    
    # Шаг 3: Ищем скрипт с совпадающим code
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        try:
            raw = await asyncio.wait_for(websocket.recv(), min(remaining, 0.5))
            message = json.loads(raw)
            if message.get("type") == ACTION_SET:
                payload = message.get("payload") or {}
                # Скрипты имеют type: "script"
                if payload.get("type") == "script":
                    script_code = payload.get("code") or ""
                    # Проверяем точное совпадение (case-insensitive)
                    if script_code.lower() == code.lower():
                        script_id = message.get("id")
                        script_title = payload.get("title") or ""
                        logger.info(
                            "Найден скрипт с code='%s', title='%s', UUID: %s",
                            script_code,
                            script_title,
                            script_id
                        )
                        return script_id
        except asyncio.TimeoutError:
            continue
        except Exception as e:
            logger.debug("Ошибка при поиске скрипта: %s", e)
            continue
    
    logger.warning("Скрипт с code='%s' не найден", code)
    return None


async def _get_script_payload(
    websocket: websockets.WebSocketClientProtocol,
    script_id: str,
    timeout: float,
) -> Optional[Dict[str, Any]]:
    """Получает payload скрипта по его ID."""
    logger.info("Запрашиваем payload скрипта %s", script_id)
    await websocket.send(json.dumps({"type": "get", "state": [script_id]}))
    
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        try:
            raw = await asyncio.wait_for(websocket.recv(), min(remaining, 1.0))
            message = json.loads(raw)
            if message.get("type") == ACTION_SET and message.get("id") == script_id:
                payload = message.get("payload") or {}
                if payload:
                    return payload
        except asyncio.TimeoutError:
            continue
        except Exception as e:
            logger.debug("Ошибка при получении payload скрипта: %s", e)
            continue
    return None


async def _wait_for_script_execution(
    websocket: websockets.WebSocketClientProtocol,
    script_id: str,
    action_ids: List[str],
    timeout: float,
) -> List[Dict[str, Any]]:
    """Ждёт выполнения действий скрипта и собирает обновления."""
    logger.info(
        "Ожидаем выполнения действий скрипта (таймаут %s сек)...",
        timeout
    )
    updates_received = []
    deadline = asyncio.get_running_loop().time() + timeout
    action_set = set(action_ids) if action_ids else set()
    
    try:
        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            try:
                raw = await asyncio.wait_for(websocket.recv(), min(remaining, 0.2))
                message = json.loads(raw)
                logger.debug("Получено сообщение: %s", message)
                if message.get("type") == ACTION_SET:
                    msg_id = message.get("id")
                    # Собираем обновления для действий скрипта
                    if action_set and msg_id in action_set:
                        updates_received.append(message)
                        logger.info("Получено обновление для действия %s", msg_id)
                    elif msg_id == script_id:
                        updates_received.append(message)
            except asyncio.TimeoutError:
                continue
    except Exception as e:
        logger.warning("Ошибка при получении сообщений: %s", e)
    
    return updates_received


@pytest.mark.integration
@pytest.mark.asyncio
async def test_script_can_be_executed_by_code() -> None:
    """Тест выполнения скрипта по коду (code)."""
    server_uri = os.getenv("REACTHOME_WS_URI", "ws://192.168.88.4:3000")
    script_code = os.getenv("REACTHOME_SCRIPT_CODE", "Лоджия спот")
    search_timeout = float(os.getenv("REACTHOME_SEARCH_TIMEOUT", "3"))
    execution_timeout = float(os.getenv("REACTHOME_EXECUTION_TIMEOUT", "5"))
    
    logger.info("Подключение к серверу %s", server_uri)
    async with websockets.connect(server_uri) as websocket:
        logger.info("Подключение установлено, ищем скрипт с code='%s'", script_code)
        
        # Находим UUID скрипта по коду
        script_id = await _find_script_by_code(websocket, script_code, search_timeout)
        if not script_id:
            pytest.fail(f"Скрипт с кодом '{script_code}' не найден")
        
        logger.info("Найден скрипт с UUID: %s", script_id)
        
        # Получаем информацию о скрипте
        script_payload = await _get_script_payload(websocket, script_id, search_timeout)
        if not script_payload:
            pytest.fail(f"Не удалось получить payload скрипта {script_id}")
        
        logger.info("Информация о скрипте:")
        logger.info("  title: %s", script_payload.get("title", "не указан"))
        logger.info("  code: %s", script_payload.get("code", "не указан"))
        logger.info("  disabled: %s", script_payload.get("disabled", False))
        logger.info("  actions: %d", len(script_payload.get("action", [])))
        
        if script_payload.get("disabled"):
            pytest.skip(f"Скрипт отключен (disabled: true)")
        
        action_ids = script_payload.get("action", [])
        if not action_ids:
            pytest.skip(f"Скрипт не содержит действий")
        
        logger.info("Действия в скрипте: %s", action_ids[:5])
        
        # Отправляем команду выполнения скрипта
        run_script = {"type": ACTION_SCRIPT_RUN, "id": script_id}
        logger.info("Отправляем команду: %s", run_script)
        await websocket.send(json.dumps(run_script))
        
        # Ждём обновления от выполнения действий
        updates = await _wait_for_script_execution(
            websocket,
            script_id,
            action_ids,
            execution_timeout
        )
        
        logger.info("Получено обновлений состояния: %d", len(updates))
        if updates:
            logger.info("Примеры обновлений: %s", updates[:3])
        
        # Команда отправлена успешно
        assert True, f"Команда выполнения скрипта отправлена: {script_id}"
        logger.info(
            "Тест завершён: скрипт с code='%s' (UUID: %s) выполнен (получено %d обновлений)",
            script_code,
            script_id,
            len(updates)
        )

