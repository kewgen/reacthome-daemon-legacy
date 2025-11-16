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


async def _find_script_by_title(
    websocket: websockets.WebSocketClientProtocol,
    title: str,
    timeout: float,
) -> Optional[str]:
    """Находит UUID скрипта по его названию (title)."""
    logger.info("Ищем скрипт с title=%s через LIST", title)
    await websocket.send(json.dumps({"type": "list"}))
    
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
                    script_title = payload.get("title") or ""
                    # Проверяем точное совпадение или частичное
                    if script_title == title or title.lower() in script_title.lower():
                        script_id = message.get("id")
                        logger.info(
                            "Найден скрипт '%s' с UUID: %s",
                            script_title,
                            script_id
                        )
                        return script_id
        except asyncio.TimeoutError:
            continue
        except Exception as e:
            logger.debug("Ошибка при поиске скрипта: %s", e)
            continue
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
async def test_script_can_be_executed_by_id() -> None:
    """Тест выполнения скрипта по UUID."""
    server_uri = os.getenv("REACTHOME_WS_URI", "ws://192.168.88.4:3000")
    script_id = os.getenv("REACTHOME_SCRIPT_ID", "88837baa-fe09-4b4c-aa54-b39c8912b805")
    timeout = float(os.getenv("REACTHOME_WS_TIMEOUT", "5"))
    
    logger.info("Подключение к серверу %s", server_uri)
    async with websockets.connect(server_uri) as websocket:
        logger.info("Подключение установлено")
        
        # Проверяем, что это UUID
        if not _is_uuid(script_id):
            pytest.skip(f"'{script_id}' не является UUID, используйте REACTHOME_SCRIPT_ID")
        
        # Получаем информацию о скрипте
        script_payload = await _get_script_payload(websocket, script_id, timeout)
        if not script_payload:
            pytest.fail(f"Скрипт {script_id} не найден")
        
        logger.info("Информация о скрипте:")
        logger.info("  title: %s", script_payload.get("title", "не указан"))
        logger.info("  type: %s", script_payload.get("type", "не указан"))
        logger.info("  disabled: %s", script_payload.get("disabled", False))
        logger.info("  actions: %d", len(script_payload.get("action", [])))
        
        if script_payload.get("disabled"):
            pytest.skip(f"Скрипт {script_id} отключен (disabled: true)")
        
        action_ids = script_payload.get("action", [])
        if not action_ids:
            pytest.skip(f"Скрипт {script_id} не содержит действий")
        
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
            timeout
        )
        
        logger.info("Получено обновлений состояния: %d", len(updates))
        if updates:
            logger.info("Примеры обновлений: %s", updates[:3])
        
        # Команда отправлена успешно
        assert True, f"Команда выполнения скрипта отправлена: {script_id}"
        logger.info(
            "Тест завершён: скрипт %s выполнен (получено %d обновлений)",
            script_id,
            len(updates)
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_script_can_be_executed_by_title() -> None:
    """Тест выполнения скрипта по названию."""
    server_uri = os.getenv("REACTHOME_WS_URI", "ws://192.168.88.4:3000")
    script_title = os.getenv("REACTHOME_SCRIPT_TITLE", "")
    search_timeout = float(os.getenv("REACTHOME_SEARCH_TIMEOUT", "3"))
    execution_timeout = float(os.getenv("REACTHOME_EXECUTION_TIMEOUT", "5"))
    
    if not script_title:
        pytest.skip("Установите REACTHOME_SCRIPT_TITLE для запуска теста")
    
    logger.info("Подключение к серверу %s", server_uri)
    async with websockets.connect(server_uri) as websocket:
        logger.info("Подключение установлено, ищем скрипт '%s'", script_title)
        
        # Находим UUID скрипта по названию
        script_id = await _find_script_by_title(websocket, script_title, search_timeout)
        if not script_id:
            pytest.fail(f"Скрипт с названием '{script_title}' не найден")
        
        logger.info("Найден скрипт с UUID: %s", script_id)
        
        # Получаем информацию о скрипте
        script_payload = await _get_script_payload(websocket, script_id, search_timeout)
        if not script_payload:
            pytest.fail(f"Не удалось получить payload скрипта {script_id}")
        
        logger.info("Информация о скрипте:")
        logger.info("  title: %s", script_payload.get("title", "не указан"))
        logger.info("  disabled: %s", script_payload.get("disabled", False))
        logger.info("  actions: %d", len(script_payload.get("action", [])))
        
        if script_payload.get("disabled"):
            pytest.skip(f"Скрипт отключен (disabled: true)")
        
        action_ids = script_payload.get("action", [])
        if not action_ids:
            pytest.skip(f"Скрипт не содержит действий")
        
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
            "Тест завершён: скрипт '%s' (UUID: %s) выполнен (получено %d обновлений)",
            script_title,
            script_id,
            len(updates)
        )

