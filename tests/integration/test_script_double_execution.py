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
                if payload.get("type") == "script":
                    script_title = payload.get("title") or ""
                    # Проверяем точное совпадение или частичное (case-insensitive)
                    if (script_title.lower() == title.lower() or 
                        title.lower() in script_title.lower()):
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


async def _collect_updates_during_execution(
    websocket: websockets.WebSocketClientProtocol,
    duration: float,
) -> List[Dict[str, Any]]:
    """Собирает все обновления состояния в течение указанного времени."""
    updates = []
    deadline = asyncio.get_running_loop().time() + duration
    
    try:
        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            try:
                raw = await asyncio.wait_for(websocket.recv(), min(remaining, 0.2))
                message = json.loads(raw)
                if message.get("type") == ACTION_SET:
                    updates.append(message)
                    logger.debug("Получено обновление: %s", message.get("id"))
            except asyncio.TimeoutError:
                continue
    except Exception as e:
        logger.warning("Ошибка при получении сообщений: %s", e)
    
    return updates


@pytest.mark.integration
@pytest.mark.asyncio
async def test_script_double_execution_with_interval() -> None:
    """Тест двойного выполнения скрипта с интервалом 1 секунда."""
    server_uri = os.getenv("REACTHOME_WS_URI", "ws://192.168.88.4:3000")
    script_id_env = os.getenv("REACTHOME_SCRIPT_ID", "")
    script_title = os.getenv("REACTHOME_SCRIPT_TITLE", "Лоджия спот")
    interval = float(os.getenv("REACTHOME_EXECUTION_INTERVAL", "1.0"))
    search_timeout = float(os.getenv("REACTHOME_SEARCH_TIMEOUT", "3"))
    execution_timeout = float(os.getenv("REACTHOME_EXECUTION_TIMEOUT", "5"))
    
    logger.info("Подключение к серверу %s", server_uri)
    async with websockets.connect(server_uri) as websocket:
        logger.info("Подключение установлено")
        
        # Если передан UUID напрямую, используем его
        if script_id_env and _is_uuid(script_id_env):
            script_id = script_id_env
            logger.info("Используем переданный UUID скрипта: %s", script_id)
        else:
            # Находим UUID скрипта по названию
            logger.info("Ищем скрипт '%s'", script_title)
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
        
        logger.info("Действия в скрипте: %s", action_ids[:5])
        
        # Первое выполнение
        logger.info("=== ПЕРВОЕ ВЫПОЛНЕНИЕ ===")
        run_script_1 = {"type": ACTION_SCRIPT_RUN, "id": script_id}
        logger.info("Отправляем команду #1: %s", run_script_1)
        await websocket.send(json.dumps(run_script_1))
        timestamp_1 = asyncio.get_running_loop().time()
        
        # Собираем обновления после первого выполнения
        updates_1 = await _collect_updates_during_execution(websocket, interval)
        logger.info("После первого выполнения получено обновлений: %d", len(updates_1))
        
        # Ждём интервал
        logger.info("Ожидание интервала %s секунд...", interval)
        await asyncio.sleep(interval)
        
        # Второе выполнение
        logger.info("=== ВТОРОЕ ВЫПОЛНЕНИЕ ===")
        run_script_2 = {"type": ACTION_SCRIPT_RUN, "id": script_id}
        logger.info("Отправляем команду #2: %s", run_script_2)
        await websocket.send(json.dumps(run_script_2))
        timestamp_2 = asyncio.get_running_loop().time()
        
        # Собираем обновления после второго выполнения
        updates_2 = await _collect_updates_during_execution(websocket, execution_timeout)
        logger.info("После второго выполнения получено обновлений: %d", len(updates_2))
        
        # Анализ результатов
        total_updates = len(updates_1) + len(updates_2)
        actual_interval = timestamp_2 - timestamp_1
        
        logger.info("\n=== РЕЗУЛЬТАТЫ ===")
        logger.info("Интервал между выполнениями: %.2f сек (ожидалось: %.2f сек)", actual_interval, interval)
        logger.info("Обновлений после первого выполнения: %d", len(updates_1))
        logger.info("Обновлений после второго выполнения: %d", len(updates_2))
        logger.info("Всего обновлений: %d", total_updates)
        
        if updates_1:
            logger.info("Примеры обновлений #1: %s", [u.get("id") for u in updates_1[:3]])
        if updates_2:
            logger.info("Примеры обновлений #2: %s", [u.get("id") for u in updates_2[:3]])
        
        # Проверки
        assert actual_interval >= interval - 0.1, f"Интервал слишком короткий: {actual_interval} < {interval}"
        assert total_updates > 0, "Не получено обновлений состояния"
        
        logger.info("\n✅ Тест завершён успешно: скрипт выполнен дважды с интервалом ~%.2f сек", actual_interval)

