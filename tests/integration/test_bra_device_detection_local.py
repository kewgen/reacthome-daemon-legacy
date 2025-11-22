"""
Локальный тест определения и мониторинга состояния устройства "Бра"

Этот тест работает напрямую с локальным WebSocket сервером (ws://192.168.88.4:3000).

ТРЕБОВАНИЯ К ТЕСТУ:
===================

1. АВТОНОМНОСТЬ И НЕЗАВИСИМОСТЬ:
   - Тест должен быть абсолютно автономным и независимым от других файлов
   - Все функции и константы должны быть определены внутри этого файла
   - Нет зависимостей от других тестовых файлов или общих утилит

2. ОПИСАНИЕ СИСТЕМЫ:
   - В начале теста должно быть полное описание того, как работает система
   - Описание WebSocket протокола, команд, структуры сообщений
   - Описание логики определения изменений и фильтрации

3. КОНСТАНТЫ:
   - Все константы должны быть вынесены в начало файла
   - Должна быть возможность легко тестировать другие устройства
   - Константы настраиваются через переменные окружения

4. ШАГИ ТЕСТА:
   - Шаг 1: Определение начального состояния устройства
   - Шаг 2: Изменение состояния устройства
   - Шаг 3: Определение и проверка изменения состояния
   - Шаг 4: Восстановление состояния устройства

5. ОПРЕДЕЛЕНИЕ УСТРОЙСТВА:
   - Должно опираться на ID устройства (приоритет ID над именем)
   - Если задан UUID - используется сразу без поиска
   - Если задан MAC адрес - проверяется соответствие имени
   - Если ID не задан - поиск по имени через LIST и GET

6. REAL-TIME ЛОГИ:
   - Все логи должны выводиться в реальном времени
   - Использование функции log_now() с немедленным flush
   - Периодический вывод статуса мониторинга (каждую секунду)
   - Логи в ключевых точках выполнения теста

7. ОПТИМИЗАЦИЯ:
   - Тест должен выполняться быстро (оптимизированные таймауты)
   - Минимальные задержки между операциями
   - Увеличенный размер батчей для поиска устройств

8. ФИЛЬТРАЦИЯ:
   - Сенсоры (temperature, humidity, co2) автоматически исключаются
   - Служебные обновления (initialized, online) не считаются значимыми
   - В консоль выводятся только изменения управляющих полей (value, state, etc.)

9. ОБРАБОТКА ДАННЫХ:
   - Нормализация булевых значений к числам для сравнения
   - Сравнение состояний без поля timestamp (оно всегда разное)
   - Корректная обработка различных типов значений (bool, int)

10. ВОССТАНОВЛЕНИЕ СОСТОЯНИЯ:
    - После теста устройство должно быть возвращено в исходное состояние

СИСТЕМА РАБОТЫ:
==============

1. WebSocket сервер (порт 3000):
   - Принимает JSON сообщения с типом команды
   - Отправляет обновления состояния через ACTION_SET
   - Каждое устройство имеет уникальный ID (MAC адрес или UUID)

2. Команды управления:
   - ACTION_ON / ACTION_OFF - включение/выключение устройства
   - ACTION_SET - обновление состояния (приходит автоматически)
   - GET - получение текущего состояния устройства
   - LIST - получение списка всех устройств

3. Структура сообщения ACTION_SET:
   {
     "type": "ACTION_SET",
     "id": "device_id",
     "payload": {
       "value": 0 или 1-255 или bool,  // состояние устройства
       "timestamp": 1234567890
     }
   }

4. Определение изменений:
   - Сравниваем payload без поля timestamp (оно всегда разное)
   - Фиксируем изменения в поле "value"
   - Устройство "Бра" - это переключатель света (light_switch)
   - Значение value: 0/False = выключено, >0/True = включено с уровнем яркости
   - Нормализация: bool -> int (True=1, False=0) для корректного сравнения

5. Фильтрация:
   - Сенсоры (temperature, humidity, co2) автоматически исключаются
   - Служебные обновления (initialized, online) не считаются значимыми
   - В консоль выводятся только изменения управляющих полей (value, state, etc.)

6. Поиск устройства:
   - Приоритет: UUID (используется сразу) > MAC адрес (проверка имени) > Поиск по имени
   - Поиск по имени: точное совпадение или совпадение как отдельное слово
   - Проверка полей title и code в payload
"""

import asyncio
import json
import logging
import os
import re
import sys
from collections import deque
from typing import Any, Dict, List, Optional, Tuple, TypedDict
from urllib.parse import urlparse

import pytest
import websockets
from websockets.exceptions import ConnectionClosed, InvalidURI, WebSocketException

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=os.getenv("REACTHOME_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    stream=sys.stderr,
    force=True,
)

# ============================================================================
# ТИПИЗАЦИЯ
# ============================================================================

class DevicePayload(TypedDict, total=False):
    """Типизированная структура payload устройства."""
    value: Any  # int, bool или None
    title: str
    code: str
    timestamp: float
    type: str
    site: str
    modified: float
    bind: str
    last: Dict[str, Any]
    # Дополнительные поля могут быть добавлены


class WebSocketMessage(TypedDict, total=False):
    """Типизированная структура сообщения WebSocket."""
    type: str
    id: str
    payload: DevicePayload
    state: List[Any]


class StateChange(TypedDict):
    """Информация об изменении состояния."""
    elapsed: float
    previous: DevicePayload
    current: DevicePayload


# ============================================================================
# КОНСТАНТЫ ДЛЯ НАСТРОЙКИ ТЕСТА
# ============================================================================

# ID устройства для тестирования (можно изменить для тестирования других устройств)
# По умолчанию: UUID устройства "Бра" из логов
DEVICE_ID = os.getenv("REACTHOME_TEST_DEVICE_ID", "8828b19b-55b6-4f88-ac6b-20c41b02f1ad")

# Имя устройства для фильтрации (можно изменить)
DEVICE_NAME = os.getenv("REACTHOME_TEST_DEVICE_NAME", "Бра")

# URI WebSocket сервера
WS_URI = os.getenv("REACTHOME_WS_URI", "ws://192.168.88.4:3000")
#WS_URI = os.getenv("REACTHOME_WS_URI", "wss://gate.reacthome.net/8828b19b-55b6-4f88-ac6b-20c41b02f1ad")

# Таймауты (оптимизированы для быстрого выполнения)
GET_TIMEOUT = float(os.getenv("REACTHOME_GET_TIMEOUT", "2.0"))
ACTION_TIMEOUT = float(os.getenv("REACTHOME_ACTION_TIMEOUT", "2.0"))
MONITORING_TIMEOUT = float(os.getenv("REACTHOME_MONITORING_TIMEOUT", "3.0"))
SEARCH_TIMEOUT = float(os.getenv("REACTHOME_SEARCH_TIMEOUT", "5.0"))

# Команды управления
ACTION_SET = "ACTION_SET"
ACTION_ON = "ACTION_ON"
ACTION_OFF = "ACTION_OFF"
GET = "get"
LIST = "list"

# Магические числа (вынесены в константы для ясности)
MONITORING_STARTUP_DELAY = 0.2  # Задержка перед отправкой команды после запуска мониторинга (сек)
STATUS_UPDATE_INTERVAL = 1.0  # Интервал вывода статуса мониторинга (сек)
RECV_TIMEOUT_SHORT = 0.2  # Короткий таймаут для recv (сек)
RECV_TIMEOUT_MEDIUM = 0.3  # Средний таймаут для recv (сек)
LIST_RESPONSE_TIMEOUT = 3.0  # Таймаут получения ответа LIST (сек)
BATCH_PROCESSING_TIMEOUT = 2.0  # Таймаут обработки батча устройств (сек)
BATCH_SIZE = 100  # Размер батча для поиска устройств
MAC_ADDRESS_PARTS = 6  # Количество частей в MAC адресе (XX:XX:XX:XX:XX:XX)
TURN_ON_BRIGHTNESS_LEVEL = 2  # Уровень яркости при включении устройства

# Поля для фильтрации
SIGNIFICANT_FIELDS = ["value", "fan_speed", "fan_speed_", "state", "active", "script", "time"]
SERVICE_FIELDS = {"initialized", "online", "timestamp", "type", "ready", "version", "master"}

# UUID паттерн (стандартный формат UUID v4)
UUID_PATTERN = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE
)

# MAC адрес паттерн
MAC_PATTERN = re.compile(
    r'^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$'
)


# ============================================================================
# ВАЛИДАЦИЯ ВХОДНЫХ ДАННЫХ
# ============================================================================

def validate_uuid(uuid_str: str) -> bool:
    """Проверяет, является ли строка валидным UUID."""
    return bool(UUID_PATTERN.match(uuid_str))


def validate_mac_address(mac_str: str) -> bool:
    """Проверяет, является ли строка валидным MAC адресом."""
    return bool(MAC_PATTERN.match(mac_str))


def validate_ws_uri(uri: str) -> bool:
    """Проверяет, является ли строка валидным WebSocket URI."""
    try:
        parsed = urlparse(uri)
        return parsed.scheme in ('ws', 'wss') and parsed.netloc
    except Exception:
        return False


def validate_device_id(device_id: Optional[str]) -> Tuple[bool, Optional[str]]:
    """
    Валидирует ID устройства.
    
    Returns:
        (is_valid, error_message)
    """
    if not device_id:
        return True, None  # Пустой ID допустим (будет поиск по имени)
    
    if validate_uuid(device_id):
        return True, None
    
    if validate_mac_address(device_id):
        return True, None
    
    return False, f"ID устройства '{device_id}' не является валидным UUID или MAC адресом"


def validate_config() -> None:
    """Валидирует конфигурацию теста."""
    is_valid, error = validate_device_id(DEVICE_ID)
    if not is_valid:
        raise ValueError(f"Невалидная конфигурация: {error}")
    
    if not validate_ws_uri(WS_URI):
        raise ValueError(f"Невалидный WebSocket URI: {WS_URI}")
    
    if not DEVICE_NAME or not DEVICE_NAME.strip():
        raise ValueError("Имя устройства не может быть пустым")


# ============================================================================
# УТИЛИТЫ
# ============================================================================

def log_now(*args, **kwargs):
    """
    Выводит сообщение в stderr немедленно, без буферизации.
    Обеспечивает real-time вывод логов во время выполнения теста.
    """
    msg = ' '.join(str(arg) for arg in args) + '\n'
    sys.stderr.write(msg)
    sys.stderr.flush()


def normalize_value(value: Any) -> int:
    """
    Нормализует значение устройства к целому числу.
    
    Args:
        value: Значение (bool, int, или другой тип)
        
    Returns:
        Нормализованное целое число (0 для False/None, 1 для True, значение для int)
    """
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return value
    return 0


def remove_timestamp(payload: DevicePayload) -> Dict[str, Any]:
    """
    Удаляет поле timestamp из payload для сравнения.
    
    Args:
        payload: Payload устройства
        
    Returns:
        Payload без поля timestamp
    """
    return {k: v for k, v in payload.items() if k != "timestamp"}


def normalize_payload_for_comparison(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Нормализует payload для сравнения (удаляет timestamp, нормализует value).
    
    Args:
        payload: Payload устройства
        
    Returns:
        Нормализованный payload
    """
    normalized = remove_timestamp(payload)
    if "value" in normalized:
        normalized["value"] = normalize_value(normalized["value"])
    return normalized


def is_significant_change(payload: DevicePayload) -> bool:
    """
    Определяет, является ли изменение состояния значимым.
    
    Args:
        payload: Payload устройства
        
    Returns:
        True если изменение значимое
    """
    # Если payload содержит ТОЛЬКО служебные поля - это не значимое изменение
    if set(payload.keys()).issubset(SERVICE_FIELDS):
        return False
    
    # Если есть значимые поля - это важное изменение
    if any(key in payload for key in SIGNIFICANT_FIELDS):
        non_service_keys = set(payload.keys()) - SERVICE_FIELDS
        if non_service_keys:
            return True
    
    return False


# ============================================================================
# ОБРАБОТКА СЕТЕВЫХ ОШИБОК
# ============================================================================

class WebSocketError(Exception):
    """Базовое исключение для ошибок WebSocket."""
    pass


class ConnectionError(WebSocketError):
    """Ошибка подключения к WebSocket."""
    pass


class TimeoutError(WebSocketError):
    """Таймаут операции WebSocket."""
    pass


async def safe_websocket_connect(uri: str, timeout: float = 10.0) -> websockets.WebSocketClientProtocol:
    """
    Безопасное подключение к WebSocket с обработкой ошибок.
    
    Args:
        uri: URI WebSocket сервера
        timeout: Таймаут подключения
        
    Returns:
        WebSocket соединение
        
    Raises:
        ConnectionError: При ошибке подключения
    """
    try:
        websocket = await asyncio.wait_for(
            websockets.connect(uri),
            timeout=timeout
        )
        return websocket
    except asyncio.TimeoutError:
        raise ConnectionError(f"Таймаут подключения к WebSocket {uri}")
    except (InvalidURI, WebSocketException) as e:
        raise ConnectionError(f"Ошибка подключения к WebSocket {uri}: {e}")
    except Exception as e:
        raise ConnectionError(f"Неожиданная ошибка при подключении к WebSocket {uri}: {e}")


async def safe_websocket_send(websocket: websockets.WebSocketClientProtocol, message: Dict[str, Any]) -> None:
    """
    Безопасная отправка сообщения через WebSocket.
    
    Args:
        websocket: WebSocket соединение
        message: Сообщение для отправки
        
    Raises:
        ConnectionError: При ошибке отправки
    """
    try:
        await websocket.send(json.dumps(message))
    except ConnectionClosed:
        raise ConnectionError("WebSocket соединение закрыто")
    except Exception as e:
        raise ConnectionError(f"Ошибка отправки сообщения: {e}")


async def safe_websocket_recv(websocket: websockets.WebSocketClientProtocol, timeout: float = RECV_TIMEOUT_SHORT) -> Optional[str]:
    """
    Безопасное получение сообщения через WebSocket.
    
    Args:
        websocket: WebSocket соединение
        timeout: Таймаут получения
        
    Returns:
        Полученное сообщение или None при таймауте
        
    Raises:
        ConnectionError: При ошибке получения
    """
    try:
        return await asyncio.wait_for(websocket.recv(), timeout=timeout)
    except asyncio.TimeoutError:
        return None
    except ConnectionClosed:
        raise ConnectionError("WebSocket соединение закрыто")
    except Exception as e:
        raise ConnectionError(f"Ошибка получения сообщения: {e}")


# ============================================================================
# ПОИСК УСТРОЙСТВ (ОПТИМИЗИРОВАН)
# ============================================================================

async def get_device_list(websocket: websockets.WebSocketClientProtocol, timeout: float = LIST_RESPONSE_TIMEOUT) -> List[str]:
    """
    Получает список всех устройств через LIST.
    
    Args:
        websocket: WebSocket соединение
        timeout: Таймаут получения списка
        
    Returns:
        Список ID устройств
    """
    await safe_websocket_send(websocket, {"type": LIST})
    
    device_ids = []
    deadline = asyncio.get_running_loop().time() + timeout
    
    while asyncio.get_running_loop().time() < deadline:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        
        raw = await safe_websocket_recv(websocket, min(remaining, RECV_TIMEOUT_MEDIUM))
        if not raw:
            continue
        
        try:
            message: WebSocketMessage = json.loads(raw)
            
            if message.get("type") == LIST and message.get("state"):
                for item in message.get("state", []):
                    if isinstance(item, list) and len(item) > 0:
                        device_ids.append(item[0])
                break
        except json.JSONDecodeError:
            continue
    
    return device_ids


def matches_device_name(payload: DevicePayload, device_name: str) -> bool:
    """
    Проверяет, соответствует ли payload имени устройства.
    
    Args:
        payload: Payload устройства
        device_name: Имя устройства для поиска
        
    Returns:
        True если соответствует
    """
    device_name_lower = device_name.lower()
    title = payload.get("title", "")
    code = payload.get("code", "")
    
    # Точное совпадение
    if title and title.lower() == device_name_lower:
        return True
    if code and code.lower() == device_name_lower:
        return True
    
    # Совпадение как отдельное слово
    if title:
        title_words = title.lower().split()
        if device_name_lower in title_words:
            return True
    if code:
        code_words = code.lower().split()
        if device_name_lower in code_words:
            return True
    
    return False


async def find_device_in_batch(
    websocket: websockets.WebSocketClientProtocol,
    device_ids: List[str],
    device_name: str,
    timeout: float = BATCH_PROCESSING_TIMEOUT
) -> Optional[str]:
    """
    Ищет устройство в батче ID.
    
    Args:
        websocket: WebSocket соединение
        device_ids: Список ID устройств для проверки
        device_name: Имя устройства для поиска
        timeout: Таймаут обработки батча
        
    Returns:
        ID найденного устройства или None
    """
    await safe_websocket_send(websocket, {"type": GET, "state": device_ids})
    
    deadline = asyncio.get_running_loop().time() + timeout
    received = set()
    
    while asyncio.get_running_loop().time() < deadline:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        
        raw = await safe_websocket_recv(websocket, min(remaining, RECV_TIMEOUT_SHORT))
        if not raw:
            continue
        
        try:
            message: WebSocketMessage = json.loads(raw)
            
            if message.get("type") == ACTION_SET:
                device_id = message.get("id")
                if not device_id:
                    continue
                
                payload = message.get("payload", {})
                if matches_device_name(payload, device_name):
                    title = payload.get("title", "")
                    code = payload.get("code", "")
                    name = title or code or device_id
                    log_now(f"✅ Найдено устройство: '{name}' (ID: {device_id})")
                    return device_id
                
                received.add(device_id)
                if len(received) == len(device_ids):
                    break
        except (json.JSONDecodeError, KeyError):
            continue
    
    return None


async def find_device_by_name(
    websocket: websockets.WebSocketClientProtocol,
    device_name: str,
    timeout: float = SEARCH_TIMEOUT
) -> Optional[str]:
    """
    Находит устройство по имени через LIST и GET.
    
    Args:
        websocket: WebSocket соединение
        device_name: Имя устройства для поиска
        timeout: Таймаут поиска
        
    Returns:
        ID устройства или None если не найдено
    """
    log_now(f"🔍 Ищем устройство по имени: '{device_name}'...")
    
    device_ids = await get_device_list(websocket, min(timeout, LIST_RESPONSE_TIMEOUT))
    
    if not device_ids:
        log_now(f"⚠️  Не удалось получить список устройств")
        return None
    
    log_now(f"📋 Получено {len(device_ids)} устройств, ищем по имени...")
    
    # Поиск батчами для оптимизации
    for i in range(0, len(device_ids), BATCH_SIZE):
        batch = device_ids[i:i + BATCH_SIZE]
        log_now(f"   Проверяем батч {i // BATCH_SIZE + 1} ({len(batch)} устройств)...")
        
        found = await find_device_in_batch(websocket, batch, device_name, BATCH_PROCESSING_TIMEOUT)
        if found:
            return found
    
    log_now(f"⚠️  Устройство с именем '{device_name}' не найдено")
    return None


# ============================================================================
# РАБОТА С УСТРОЙСТВАМИ
# ============================================================================

async def get_device_state(
    websocket: websockets.WebSocketClientProtocol,
    device_id: str,
    timeout: float = GET_TIMEOUT
) -> Optional[DevicePayload]:
    """
    Получает текущее состояние устройства через GET.
    
    Args:
        websocket: WebSocket соединение
        device_id: ID устройства
        timeout: Таймаут ожидания ответа
        
    Returns:
        payload устройства или None если не получено
    """
    log_now(f"📥 Запрашиваем состояние устройства {device_id}...")
    
    await safe_websocket_send(websocket, {"type": GET, "state": [device_id]})
    log_now(f"   ⏳ Ожидаем ответ...")
    
    deadline = asyncio.get_running_loop().time() + timeout
    
    while asyncio.get_running_loop().time() < deadline:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        
        raw = await safe_websocket_recv(websocket, min(remaining, RECV_TIMEOUT_MEDIUM))
        if not raw:
            continue
        
        try:
            message: WebSocketMessage = json.loads(raw)
            
            if message.get("type") == ACTION_SET and message.get("id") == device_id:
                payload = message.get("payload", {})
                log_now(f"✅ Получено состояние: {json.dumps(payload, ensure_ascii=False)}")
                return payload
        except (json.JSONDecodeError, KeyError):
            continue
        except ConnectionError:
            raise
    
    log_now(f"⚠️  Не удалось получить состояние устройства за {timeout} сек")
    return None


# ============================================================================
# МОНИТОРИНГ ИЗМЕНЕНИЙ (РАЗДЕЛЁН НА ФУНКЦИИ)
# ============================================================================

async def read_websocket_message(
    websocket: websockets.WebSocketClientProtocol,
    device_id: str,
    timeout: float = RECV_TIMEOUT_SHORT
) -> Optional[WebSocketMessage]:
    """
    Читает сообщение WebSocket, фильтруя по device_id.
    
    Args:
        websocket: WebSocket соединение
        device_id: ID устройства для фильтрации
        timeout: Таймаут чтения
        
    Returns:
        Сообщение или None
    """
    raw = await safe_websocket_recv(websocket, timeout)
    if not raw:
        return None
    
    try:
        message: WebSocketMessage = json.loads(raw)
        if message.get("type") == ACTION_SET and message.get("id") == device_id:
            return message
    except (json.JSONDecodeError, KeyError):
        pass
    
    return None


def is_state_changed(
    current: DevicePayload,
    previous: DevicePayload
) -> bool:
    """
    Проверяет, изменилось ли состояние устройства.
    
    Args:
        current: Текущее состояние
        previous: Предыдущее состояние
        
    Returns:
        True если состояние изменилось
    """
    current_normalized = normalize_payload_for_comparison(current)
    previous_normalized = normalize_payload_for_comparison(previous)
    return current_normalized != previous_normalized


def create_change_info(
    current: DevicePayload,
    previous: DevicePayload,
    elapsed: float
) -> StateChange:
    """
    Создаёт информацию об изменении состояния.
    
    Args:
        current: Текущее состояние
        previous: Предыдущее состояние
        elapsed: Время с начала мониторинга
        
    Returns:
        Информация об изменении
    """
    # Копируем только необходимые поля для экономии памяти
    return {
        "elapsed": elapsed,
        "previous": {k: v for k, v in previous.items() if k in ("value", "title", "code")},
        "current": {k: v for k, v in current.items() if k in ("value", "title", "code")},
    }


async def monitor_state_changes(
    websocket: websockets.WebSocketClientProtocol,
    device_id: str,
    initial_state: DevicePayload,
    duration: float = MONITORING_TIMEOUT,
    ready_event: Optional[asyncio.Event] = None
) -> List[StateChange]:
    """
    Мониторит изменения состояния устройства.
    
    Args:
        websocket: WebSocket соединение
        device_id: ID устройства
        initial_state: Начальное состояние для сравнения
        duration: Длительность мониторинга в секундах
        ready_event: Событие для сигнализации о готовности мониторинга
        
    Returns:
        Список зафиксированных изменений
    """
    log_now(f"🔍 Мониторинг изменений состояния устройства {device_id} (длительность: {duration} сек)...")
    
    changes: List[StateChange] = []
    # Используем только необходимые поля для экономии памяти
    last_state = {k: v for k, v in initial_state.items() if k in ("value", "title", "code", "timestamp")}
    start_time = asyncio.get_running_loop().time()
    deadline = start_time + duration
    last_status_time = start_time
    
    # Сигнализируем о готовности мониторинга (исправление race condition)
    if ready_event:
        ready_event.set()
    
    while asyncio.get_running_loop().time() < deadline:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        
        # Периодически выводим статус мониторинга
        current_time = asyncio.get_running_loop().time()
        if current_time - last_status_time >= STATUS_UPDATE_INTERVAL:
            elapsed = current_time - start_time
            log_now(f"   ⏳ Мониторинг: +{elapsed:.1f}с, изменений: {len(changes)}")
            last_status_time = current_time
        
        message = await read_websocket_message(websocket, device_id, min(remaining, RECV_TIMEOUT_SHORT))
        if not message:
            continue
        
        payload = message.get("payload", {})
        
        # Проверяем, изменилось ли состояние
        if is_state_changed(payload, last_state):
            if is_significant_change(payload):
                elapsed = asyncio.get_running_loop().time() - start_time
                change_info = create_change_info(payload, last_state, elapsed)
                changes.append(change_info)
                
                # Нормализуем значения для вывода
                value_prev = normalize_value(last_state.get("value", 0))
                value_curr = normalize_value(payload.get("value", 0))
                
                log_now(f"📊 Изменение зафиксировано (+{elapsed:.2f}с): value {value_prev} → {value_curr}")
                
                # Обновляем только необходимые поля
                last_state = {k: v for k, v in payload.items() if k in ("value", "title", "code", "timestamp")}
    
    log_now(f"✅ Мониторинг завершён. Зафиксировано изменений: {len(changes)}")
    return changes


# ============================================================================
# ОСНОВНОЙ ТЕСТ
# ============================================================================

@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize("device_id,device_name", [
    (None, None),  # Используются значения по умолчанию
])
async def test_bra_device_detection_and_state_change_local(
    device_id: Optional[str],
    device_name: Optional[str]
):
    """
    Локальный тест определения и изменения состояния устройства "Бра".
    
    Работает напрямую с локальным WebSocket сервером (ws://192.168.88.4:3000).
    
    Шаги:
    1. Определение начального состояния устройства
    2. Изменение состояния (включение/выключение)
    3. Определение и проверка изменения состояния
    4. Восстановление состояния устройства
    
    Args:
        device_id: ID устройства (опционально, переопределяет DEVICE_ID)
        device_name: Имя устройства (опционально, переопределяет DEVICE_NAME)
    """
    # Используем переданные параметры или значения по умолчанию
    test_device_id = device_id if device_id is not None else DEVICE_ID
    test_device_name = device_name if device_name is not None else DEVICE_NAME
    
    # Валидация конфигурации
    try:
        validate_config()
    except ValueError as e:
        pytest.fail(f"Ошибка конфигурации: {e}")
    
    log_now("=" * 80)
    log_now("ТЕСТ ОПРЕДЕЛЕНИЯ И ИЗМЕНЕНИЯ СОСТОЯНИЯ УСТРОЙСТВА")
    log_now("=" * 80)
    log_now(f"Имя устройства для поиска: {test_device_name}")
    
    is_valid, error = validate_device_id(test_device_id)
    if not is_valid and error:
        log_now(f"⚠️  {error}")
    
    if test_device_id and validate_mac_address(test_device_id):
        log_now(f"ID устройства (MAC адрес): {test_device_id}")
    elif test_device_id and validate_uuid(test_device_id):
        log_now(f"ID устройства (UUID): {test_device_id}")
    else:
        log_now(f"ID устройства (будет найден по имени): {test_device_id or 'не задан'}")
    
    log_now(f"WebSocket сервер: {WS_URI}")
    log_now("")
    
    try:
        websocket = await safe_websocket_connect(WS_URI)
    except ConnectionError as e:
        pytest.fail(f"Не удалось подключиться к WebSocket: {e}")
    
    try:
        log_now("✅ Подключение к WebSocket установлено\n")
        
        # ====================================================================
        # ПРЕДВАРИТЕЛЬНЫЙ ШАГ: ПОИСК УСТРОЙСТВА
        # ====================================================================
        log_now("┌─ ПРЕДВАРИТЕЛЬНЫЙ ШАГ: Поиск устройства")
        log_now(f"   Ищем устройство '{test_device_name}'...")
        
        # Определяем actual_device_id с приоритетом ID над именем
        if test_device_id and validate_uuid(test_device_id):
            # UUID - используем сразу
            log_now(f"   Используем указанный UUID: {test_device_id}")
            actual_device_id = test_device_id
        elif test_device_id and validate_mac_address(test_device_id):
            # MAC адрес - проверяем соответствие имени
            log_now(f"   Проверяем указанный MAC адрес: {test_device_id}...")
            check_state = await get_device_state(websocket, test_device_id, timeout=1.0)
            if check_state and matches_device_name(check_state, test_device_name):
                title = check_state.get("title", "")
                code = check_state.get("code", "")
                log_now(f"✅ Указанный MAC адрес соответствует устройству '{title or code}'")
                actual_device_id = test_device_id
            else:
                log_now(f"⚠️  Указанный MAC адрес не соответствует '{test_device_name}'")
                log_now(f"   Ищем устройство по имени...")
                actual_device_id = await find_device_by_name(websocket, test_device_name, timeout=SEARCH_TIMEOUT)
        else:
            # ID не задан или невалидный - ищем по имени
            actual_device_id = await find_device_by_name(websocket, test_device_name, timeout=SEARCH_TIMEOUT)
        
        if not actual_device_id:
            pytest.fail(f"Не удалось найти устройство с именем '{test_device_name}'")
        
        log_now(f"└─ ✅ Используем ID устройства: {actual_device_id}\n")
        
        # ====================================================================
        # ШАГ 1: ОПРЕДЕЛЕНИЕ НАЧАЛЬНОГО СОСТОЯНИЯ УСТРОЙСТВА
        # ====================================================================
        log_now("┌─ ШАГ 1: Определение начального состояния устройства")
        log_now(f"   Получаем текущее состояние устройства {actual_device_id} через GET команду...")
        
        initial_state = await get_device_state(websocket, actual_device_id)
        
        if not initial_state:
            pytest.fail(f"Не удалось получить начальное состояние устройства {actual_device_id}")
        
        initial_value = initial_state.get("value", "N/A")
        device_title = initial_state.get("title", "")
        device_code = initial_state.get("code", "")
        device_name_display = device_title or device_code or "N/A"
        
        log_now(f"   Начальное состояние: value = {initial_value}")
        log_now(f"   Имя устройства (title): {device_title or 'N/A'}")
        log_now(f"   Код устройства (code): {device_code or 'N/A'}")
        log_now(f"   Полный payload: {json.dumps(initial_state, ensure_ascii=False)}")
        log_now("└─ ✅ Начальное состояние определено\n")
        
        # Проверяем, что это правильное устройство
        if not matches_device_name(initial_state, test_device_name) and device_name_display != "N/A":
            log_now(f"⚠️  ВНИМАНИЕ: Найдено устройство '{device_name_display}', ожидалось '{test_device_name}'")
            log_now(f"   Продолжаем тест с найденным устройством...")
        
        initial_value_int = normalize_value(initial_value)
        
        # ====================================================================
        # ШАГ 2: ИЗМЕНЕНИЕ СОСТОЯНИЯ УСТРОЙСТВА
        # ====================================================================
        log_now("┌─ ШАГ 2: Изменение состояния устройства")
        log_now("   Выполняем команду включения/выключения...")
        
        target_action = ACTION_ON if initial_value_int == 0 else ACTION_OFF
        target_value = TURN_ON_BRIGHTNESS_LEVEL if initial_value_int == 0 else 0
        
        log_now(f"   Текущее значение: {initial_value} (нормализовано: {initial_value_int})")
        log_now(f"   Выполняем: {target_action} (ожидаемое значение: {target_value})")
        
        # ====================================================================
        # ШАГ 3: ОПРЕДЕЛЕНИЕ И ПРОВЕРКА ИЗМЕНЕНИЯ СОСТОЯНИЯ
        # ====================================================================
        log_now("\n┌─ ШАГ 3: Определение и проверка изменения состояния")
        log_now("   Запускаем мониторинг изменений состояния...")
        
        # Создаём событие для синхронизации (исправление race condition)
        monitoring_ready = asyncio.Event()
        
        # Создаём задачу мониторинга
        monitoring_task = asyncio.create_task(
            monitor_state_changes(
                websocket,
                actual_device_id,
                initial_state,
                duration=MONITORING_TIMEOUT,
                ready_event=monitoring_ready
            )
        )
        
        # Ждём готовности мониторинга перед отправкой команды
        await monitoring_ready.wait()
        await asyncio.sleep(MONITORING_STARTUP_DELAY)
        
        # Теперь выполняем изменение состояния
        log_now(f"   📤 Отправляем команду {target_action}...")
        await safe_websocket_send(websocket, {"type": target_action, "id": actual_device_id})
        log_now(f"   ✅ Команда {target_action} отправлена, ожидаем изменение состояния...")
        
        log_now("└─ ✅ Команда изменения состояния отправлена\n")
        
        # Ждём завершения мониторинга
        try:
            changes = await monitoring_task
        except ConnectionError as e:
            pytest.fail(f"Ошибка во время мониторинга: {e}")
        
        log_now("└─ ✅ Мониторинг завершён\n")
        
        # ====================================================================
        # ПРОВЕРКИ
        # ====================================================================
        log_now("=" * 80)
        log_now("РЕЗУЛЬТАТЫ ТЕСТА")
        log_now("=" * 80)
        
        assert initial_state is not None, "Начальное состояние должно быть получено"
        assert "value" in initial_state, "В начальном состоянии должно быть поле 'value'"
        assert len(changes) > 0, f"Должно быть зафиксировано хотя бы одно изменение состояния"
        
        last_change = changes[-1]
        final_value_raw = last_change["current"].get("value")
        final_value_int = normalize_value(final_value_raw)
        
        log_now(f"Начальное значение: {initial_value} (нормализовано: {initial_value_int})")
        log_now(f"Финальное значение: {final_value_raw} (нормализовано: {final_value_int})")
        log_now(f"Количество зафиксированных изменений: {len(changes)}")
        
        assert final_value_int != initial_value_int, \
            f"Значение должно было измениться с {initial_value_int} на другое, но осталось {final_value_int}"
        
        log_now("\n✅ Все проверки пройдены успешно!")
        log_now("=" * 80)
        
        # ====================================================================
        # ШАГ 4: ВОССТАНОВЛЕНИЕ СОСТОЯНИЯ УСТРОЙСТВА
        # ====================================================================
        log_now("\n┌─ ШАГ 4: Восстановление состояния устройства")
        log_now(f"   Возвращаем устройство в исходное состояние (value = {initial_value_int})...")
        
        restore_action = ACTION_ON if initial_value_int > 0 else ACTION_OFF
        
        # Создаём событие для синхронизации
        restore_monitoring_ready = asyncio.Event()
        
        # Запускаем мониторинг для подтверждения восстановления
        restore_monitoring_task = asyncio.create_task(
            monitor_state_changes(
                websocket,
                actual_device_id,
                last_change["current"],
                duration=MONITORING_TIMEOUT,
                ready_event=restore_monitoring_ready
            )
        )
        
        # Ждём готовности мониторинга
        await restore_monitoring_ready.wait()
        await asyncio.sleep(MONITORING_STARTUP_DELAY)
        
        # Отправляем команду восстановления
        log_now(f"   📤 Отправляем команду {restore_action}...")
        await safe_websocket_send(websocket, {"type": restore_action, "id": actual_device_id})
        log_now(f"   ✅ Команда {restore_action} отправлена, ожидаем восстановление состояния...")
        
        # Ждём завершения мониторинга восстановления
        try:
            restore_changes = await restore_monitoring_task
        except ConnectionError as e:
            log_now(f"   ⚠️  Ошибка во время мониторинга восстановления: {e}")
            restore_changes = []
        
        # Улучшенная проверка восстановления состояния
        if restore_changes:
            restored_value = restore_changes[-1]["current"].get("value")
            restored_value_int = normalize_value(restored_value)
            
            if restored_value_int == initial_value_int:
                log_now(f"   ✅ Состояние восстановлено: value = {restored_value} (нормализовано: {restored_value_int})")
            else:
                # Восстановление не удалось - это критическая ошибка
                pytest.fail(
                    f"Не удалось восстановить исходное состояние устройства. "
                    f"Ожидалось: {initial_value_int}, получено: {restored_value_int}"
                )
        else:
            # Восстановление не зафиксировано - критическая ошибка
            pytest.fail(
                f"Не удалось зафиксировать восстановление состояния устройства. "
                f"Устройство может остаться в изменённом состоянии."
            )
        
        log_now("└─ ✅ Восстановление состояния завершено")
        log_now("=" * 80)
    
    finally:
        # Закрываем соединение в любом случае
        try:
            await websocket.close()
        except Exception:
            pass
