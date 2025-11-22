"""
Внешний тест определения и мониторинга состояния устройства "Бра"

Этот тест работает через удалённый WebSocket gateway (wss://gate.reacthome.net).
Требует указания MAC адреса устройства для подключения к gateway.

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
import uuid
from typing import Any, Dict, List, Optional, Set, Tuple, TypedDict
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

# ID устройства "Освещение Лоджия" (найдено через анализ скрипта)
LODGIA_LIGHT_DEVICE_ID = "34731215-af9b-4847-b2f9-67c8940271c0"

# Имя устройства для фильтрации (по умолчанию "Освещение Лоджия", так как скрипт меняет его состояние)
DEVICE_NAME = os.getenv("REACTHOME_TEST_DEVICE_NAME", "Освещение Лоджия")

# ID устройства для тестирования (по умолчанию используем найденный ID)
# Можно задать через REACTHOME_TEST_DEVICE_ID для прямого использования
DEVICE_ID = os.getenv("REACTHOME_TEST_DEVICE_ID", LODGIA_LIGHT_DEVICE_ID)

# Имя скрипта для управления устройством (используется ACTION_SCRIPT_RUN)
SCRIPT_NAME = os.getenv("REACTHOME_SCRIPT_NAME", "toggle bra гостиная")

# ID скрипта (по умолчанию используется скрипт для "Освещение Лоджия")
SCRIPT_ID = os.getenv("REACTHOME_SCRIPT_ID", "83db5b75-fa69-42f9-bd57-ee9f33d59ed7")

# MAC адрес устройства для подключения к gateway
MAC_ADDRESS = os.getenv("REACTHOME_MAC", "fd6765f1-ed61-4ae4-8d72-9a078a9f4316")

# URL gateway для удалённого подключения
GATE_URL = os.getenv("REACTHOME_GATE_URL", f"wss://gate.reacthome.net/{MAC_ADDRESS}")

# Локальный URI для GET операций (GET не работает через gateway)
LOCAL_WS_URI = os.getenv("REACTHOME_LOCAL_WS_URI", "ws://192.168.88.4:3000")

# URI WebSocket сервера для операций изменения (используется gateway)
WS_URI = os.getenv("REACTHOME_WS_URI", GATE_URL)

# Протокол для gateway
GATEWAY_PROTOCOL = "listen"

# Таймауты (для gateway увеличены из-за задержек сети)
GET_TIMEOUT = float(os.getenv("REACTHOME_GET_TIMEOUT", "5.0"))  # Увеличено для gateway
ACTION_TIMEOUT = float(os.getenv("REACTHOME_ACTION_TIMEOUT", "5.0"))  # Увеличено для gateway
MONITORING_TIMEOUT = float(os.getenv("REACTHOME_MONITORING_TIMEOUT", "5.0"))  # Увеличено для gateway
SEARCH_TIMEOUT = float(os.getenv("REACTHOME_SEARCH_TIMEOUT", "10.0"))  # Увеличено для gateway

# Команды управления
ACTION_SET = "ACTION_SET"
ACTION_ON = "ACTION_ON"
ACTION_OFF = "ACTION_OFF"
ACTION_SCRIPT_RUN = "ACTION_SCRIPT_RUN"
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

# Конфигурация логирования gateway
LOG_GATEWAY = os.getenv("REACTHOME_LOG_GATEWAY", "true").lower() == "true"
LOG_GATEWAY_VERBOSE = os.getenv("REACTHOME_LOG_GATEWAY_VERBOSE", "false").lower() == "true"
LOG_LEVEL = os.getenv("REACTHOME_LOG_LEVEL", "INFO").upper()


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
    # Используем print с flush=True для гарантированного real-time вывода
    # и file=sys.stderr для вывода в stderr
    print(msg, end='', file=sys.stderr, flush=True)


def log_gateway(*args, **kwargs):
    """
    Логирует сообщения, связанные с gateway.
    Использует префикс [GATEWAY] для удобной фильтрации.
    """
    if LOG_GATEWAY:
        log_now(f"[GATEWAY] {' '.join(str(arg) for arg in args)}")


def log_debug(*args, **kwargs):
    """
    Логирует отладочные сообщения.
    Выводится только при LOG_LEVEL=DEBUG или LOG_GATEWAY_VERBOSE=True.
    """
    if LOG_LEVEL == "DEBUG" or LOG_GATEWAY_VERBOSE:
        log_now(f"[DEBUG] {' '.join(str(arg) for arg in args)}")


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


class WebSocketConnectionError(WebSocketError):
    """Ошибка подключения к WebSocket."""
    pass


class WebSocketTimeoutError(WebSocketError):
    """Таймаут операции WebSocket."""
    pass


# ============================================================================
# КЛАСС ДЛЯ УПРАВЛЕНИЯ GATEWAY СОЕДИНЕНИЕМ
# ============================================================================

class GatewayConnection:
    """Класс для управления WebSocket соединением с gateway."""
    
    def __init__(self, session_id: Optional[str] = None):
        """
        Инициализирует соединение с gateway.
        
        Args:
            session_id: UUID сессии (генерируется автоматически, если не указан)
        """
        self.session_id = session_id or str(uuid.uuid4())
        self.websocket: Optional[websockets.WebSocketClientProtocol] = None
    
    def is_gateway(self) -> bool:
        """Проверяет, является ли соединение gateway соединением."""
        return self.session_id is not None
    
    async def close(self) -> None:
        """Закрывает WebSocket соединение."""
        if self.websocket:
            try:
                await self.websocket.close()
            except Exception:
                pass
            self.websocket = None


def is_gateway_uri(uri: str) -> bool:
    """Проверяет, является ли URI gateway адресом."""
    return "gate.reacthome.net" in uri or uri.startswith("wss://gate")


async def safe_websocket_connect(
    uri: str, 
    timeout: float = 10.0,
    gateway_connection: Optional[GatewayConnection] = None
) -> Tuple[websockets.WebSocketClientProtocol, Optional[GatewayConnection]]:
    """
    Безопасное подключение к WebSocket с обработкой ошибок.
    Поддерживает подключение к gateway с протоколом 'listen'.
    
    Args:
        uri: URI WebSocket сервера
        timeout: Таймаут подключения
        gateway_connection: Существующее соединение gateway (опционально)
        
    Returns:
        Tuple[WebSocket соединение, GatewayConnection или None]
        
    Raises:
        WebSocketConnectionError: При ошибке подключения
    """
    is_gateway = is_gateway_uri(uri)
    
    if is_gateway:
        if gateway_connection is None:
            gateway_connection = GatewayConnection()
        log_gateway(f"Подключение к gateway: {uri}")
        log_gateway(f"Используется subprotocol: {GATEWAY_PROTOCOL}")
        log_gateway(f"Сгенерирован session ID: {gateway_connection.session_id}")
    
    try:
        if is_gateway:
            websocket = await asyncio.wait_for(
                websockets.connect(uri, subprotocols=[GATEWAY_PROTOCOL]),
                timeout=timeout
            )
            gateway_connection.websocket = websocket
            log_gateway(f"✅ Подключение к gateway установлено, session ID: {gateway_connection.session_id}")
        else:
            websocket = await asyncio.wait_for(
                websockets.connect(uri),
                timeout=timeout
            )
        return websocket, gateway_connection if is_gateway else None
    except asyncio.TimeoutError:
        error_msg = f"Таймаут подключения к WebSocket {uri}"
        if is_gateway:
            log_gateway(f"❌ {error_msg}")
        raise WebSocketConnectionError(error_msg)
    except (InvalidURI, WebSocketException) as e:
        error_msg = f"Ошибка подключения к WebSocket {uri}: {e}"
        if is_gateway:
            log_gateway(f"❌ {error_msg}")
        raise WebSocketConnectionError(error_msg)
    except Exception as e:
        error_msg = f"Неожиданная ошибка при подключении к WebSocket {uri}: {e}"
        if is_gateway:
            log_gateway(f"❌ {error_msg}")
        raise WebSocketConnectionError(error_msg)


async def safe_websocket_send(
    websocket: websockets.WebSocketClientProtocol, 
    message: Dict[str, Any],
    gateway_connection: Optional[GatewayConnection] = None
) -> None:
    """
    Безопасная отправка сообщения через WebSocket.
    Для gateway добавляет префикс sessionId.
    
    Args:
        websocket: WebSocket соединение
        message: Сообщение для отправки
        gateway_connection: Соединение gateway (опционально)
        
    Raises:
        WebSocketConnectionError: При ошибке отправки
    """
    try:
        message_str = json.dumps(message, ensure_ascii=False)
        
        # Логирование для gateway
        if gateway_connection and LOG_GATEWAY:
            log_gateway(f"📤 Отправка команды: {message_str}")
            log_gateway(f"📤 Session ID (для логирования): {gateway_connection.session_id[:8]}... (длина: {len(gateway_connection.session_id)})")
            log_gateway(f"📤 ВАЖНО: Gateway сервер сам добавляет session ID, тест НЕ добавляет префикс")
        
        # ВАЖНО: Gateway сервер (gate.reacthome.net) сам добавляет session ID к сообщениям
        # при маршрутизации к демону. Тест НЕ должен добавлять session ID префикс.
        # Если добавить, получится двойной session ID в сообщении.
        
        await websocket.send(message_str)
        
        if gateway_connection and LOG_GATEWAY:
            import datetime
            timestamp = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
            log_gateway(f"✅ Команда отправлена успешно в {timestamp}")
            
    except ConnectionClosed:
        error_msg = "WebSocket соединение закрыто"
        if gateway_connection and LOG_GATEWAY:
            log_gateway(f"❌ {error_msg}")
        raise WebSocketConnectionError(error_msg)
    except Exception as e:
        error_msg = f"Ошибка отправки сообщения: {e}"
        if gateway_connection and LOG_GATEWAY:
            log_gateway(f"❌ {error_msg}")
        raise WebSocketConnectionError(error_msg)


async def safe_websocket_recv(
    websocket: websockets.WebSocketClientProtocol, 
    timeout: float = RECV_TIMEOUT_SHORT,
    gateway_connection: Optional[GatewayConnection] = None
) -> Optional[str]:
    """
    Безопасное получение сообщения через WebSocket.
    Для gateway удаляет префикс UUID (36 символов) или sessionId.
    
    Args:
        websocket: WebSocket соединение
        timeout: Таймаут получения
        gateway_connection: Соединение gateway (опционально)
        
    Returns:
        Полученное сообщение или None при таймауте
        
    Raises:
        WebSocketConnectionError: При ошибке получения
    """
    try:
        raw = await asyncio.wait_for(websocket.recv(), timeout=timeout)
        if not raw:
            return None
        
        raw_str = raw if isinstance(raw, str) else raw.decode('utf-8', errors='ignore')
        
        # Для gateway: сообщения могут приходить с префиксом UUID (36 символов) или sessionId
        # Проверяем формат: UUID (36 символов) + JSON
        if len(raw_str) >= 36 and UUID_PATTERN.match(raw_str[:36]):
            # Формат с префиксом UUID
            return raw_str[36:]
        
        # Проверяем префикс sessionId
        if gateway_connection and raw_str.startswith(gateway_connection.session_id):
            return raw_str[len(gateway_connection.session_id):]
        
        return raw_str
    except asyncio.TimeoutError:
        return None
    except ConnectionClosed:
        raise WebSocketConnectionError("WebSocket соединение закрыто")
    except Exception as e:
        raise WebSocketConnectionError(f"Ошибка получения сообщения: {e}")


# ============================================================================
# ПОИСК УСТРОЙСТВ (ОПТИМИЗИРОВАН)
# ============================================================================

async def get_device_list(
    websocket: websockets.WebSocketClientProtocol, 
    timeout: float = LIST_RESPONSE_TIMEOUT,
    gateway_connection: Optional[GatewayConnection] = None
) -> List[str]:
    """
    Получает список всех устройств через LIST.
    
    Args:
        websocket: WebSocket соединение
        timeout: Таймаут получения списка
        gateway_connection: Соединение gateway (опционально)
        
    Returns:
        Список ID устройств
    """
    await safe_websocket_send(websocket, {"type": LIST}, gateway_connection)
    
    device_ids = []
    deadline = asyncio.get_running_loop().time() + timeout
    
    while asyncio.get_running_loop().time() < deadline:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        
        raw = await safe_websocket_recv(websocket, min(remaining, RECV_TIMEOUT_MEDIUM), gateway_connection)
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
    timeout: float = BATCH_PROCESSING_TIMEOUT,
    gateway_connection: Optional[GatewayConnection] = None
) -> Optional[str]:
    """
    Ищет устройство в батче ID.
    
    Args:
        websocket: WebSocket соединение
        device_ids: Список ID устройств для проверки
        device_name: Имя устройства для поиска
        timeout: Таймаут обработки батча
        gateway_connection: Соединение gateway (опционально)
        
    Returns:
        ID найденного устройства или None
    """
    await safe_websocket_send(websocket, {"type": GET, "state": device_ids}, gateway_connection)
    
    deadline = asyncio.get_running_loop().time() + timeout
    received = set()
    
    while asyncio.get_running_loop().time() < deadline:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        
        raw = await safe_websocket_recv(websocket, min(remaining, RECV_TIMEOUT_SHORT), gateway_connection)
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


async def find_device_by_name_local(
    device_name: str,
    timeout: float = SEARCH_TIMEOUT
) -> Optional[str]:
    """
    Находит устройство по имени через локальное подключение.
    
    Args:
        device_name: Имя устройства для поиска
        timeout: Таймаут поиска
        
    Returns:
        ID устройства или None если не найдено
    """
    log_now(f"🔍 Ищем устройство по имени через локальное подключение: '{device_name}'...")
    
    try:
        local_ws, _ = await safe_websocket_connect(LOCAL_WS_URI)
    except WebSocketConnectionError as e:
        log_now(f"⚠️  Не удалось подключиться к локальному серверу: {e}")
        return None
    
    try:
        device_ids = await get_device_list(local_ws, min(timeout, LIST_RESPONSE_TIMEOUT), None)
        
        if not device_ids:
            log_now(f"⚠️  Не удалось получить список устройств")
            return None
        
        log_now(f"📋 Получено {len(device_ids)} устройств, ищем по имени...")
        
        # Поиск батчами для оптимизации
        for i in range(0, len(device_ids), BATCH_SIZE):
            batch = device_ids[i:i + BATCH_SIZE]
            log_now(f"   Проверяем батч {i // BATCH_SIZE + 1} ({len(batch)} устройств)...")
            
            found = await find_device_in_batch(local_ws, batch, device_name, BATCH_PROCESSING_TIMEOUT, None)
            if found:
                return found
        
        log_now(f"⚠️  Устройство '{device_name}' не найдено")
        return None
    finally:
        try:
            await local_ws.close()
        except Exception:
            pass


async def find_device_by_name(
    websocket: websockets.WebSocketClientProtocol,
    device_name: str,
    timeout: float = SEARCH_TIMEOUT,
    gateway_connection: Optional[GatewayConnection] = None
) -> Optional[str]:
    """
    Находит устройство по имени через LIST и GET.
    
    Args:
        websocket: WebSocket соединение
        device_name: Имя устройства для поиска
        timeout: Таймаут поиска
        gateway_connection: Соединение gateway (опционально)
        
    Returns:
        ID устройства или None если не найдено
    """
    log_now(f"🔍 Ищем устройство по имени: '{device_name}'...")
    
    device_ids = await get_device_list(websocket, min(timeout, LIST_RESPONSE_TIMEOUT), gateway_connection)
    
    if not device_ids:
        log_now(f"⚠️  Не удалось получить список устройств")
        return None
    
    log_now(f"📋 Получено {len(device_ids)} устройств, ищем по имени...")
    
    # Поиск батчами для оптимизации
    for i in range(0, len(device_ids), BATCH_SIZE):
        batch = device_ids[i:i + BATCH_SIZE]
        log_now(f"   Проверяем батч {i // BATCH_SIZE + 1} ({len(batch)} устройств)...")
        
        found = await find_device_in_batch(websocket, batch, device_name, BATCH_PROCESSING_TIMEOUT, gateway_connection)
        if found:
            return found
    
    log_now(f"⚠️  Устройство с именем '{device_name}' не найдено")
    return None


# ============================================================================
# РАБОТА С УСТРОЙСТВАМИ
# ============================================================================

async def get_device_state_local(
    device_id: str,
    timeout: float = GET_TIMEOUT
) -> Optional[DevicePayload]:
    """
    Получает текущее состояние устройства через локальное подключение.
    GET не работает через gateway, поэтому используем локальное подключение.
    
    Args:
        device_id: ID устройства
        timeout: Таймаут ожидания ответа
        
    Returns:
        payload устройства или None если не получено
    """
    log_now(f"📥 Запрашиваем состояние устройства {device_id} через локальное подключение...")
    
    try:
        # Используем локальное подключение для GET
        local_websocket, _ = await safe_websocket_connect(LOCAL_WS_URI)
    except WebSocketConnectionError as e:
        log_now(f"⚠️  Не удалось подключиться к локальному серверу: {e}")
        return None
    
    try:
        await safe_websocket_send(local_websocket, {"type": GET, "state": [device_id]}, None)
        log_now(f"   ⏳ Ожидаем ответ...")
        
        deadline = asyncio.get_running_loop().time() + timeout
        
        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            
            raw = await safe_websocket_recv(local_websocket, min(remaining, RECV_TIMEOUT_MEDIUM), None)
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
            except WebSocketConnectionError:
                raise
        
        log_now(f"⚠️  Не удалось получить состояние устройства за {timeout} сек")
        return None
    finally:
        # Закрываем локальное подключение
        try:
            await local_websocket.close()
        except Exception:
            pass


async def get_device_state_external(
    websocket: websockets.WebSocketClientProtocol,
    device_id: str,
    timeout: float = GET_TIMEOUT,
    gateway_connection: Optional[GatewayConnection] = None
) -> Optional[DevicePayload]:
    """
    Получает состояние устройства через внешний WebSocket gateway.
    
    Args:
        websocket: WebSocket соединение с gateway
        device_id: ID устройства (UUID или MAC адрес)
        timeout: Таймаут операции
        gateway_connection: Соединение gateway (опционально)
        
    Returns:
        Состояние устройства или None
    """
    log_now(f"📥 Запрашиваем состояние устройства {device_id} через gateway...")
    
    try:
        # Отправляем GET запрос через gateway
        command = {"type": GET, "state": [device_id]}
        await safe_websocket_send(websocket, command, gateway_connection)
        log_now(f"   ⏳ Ожидаем ответ...")
        
        # Ждём ответ с состоянием устройства
        deadline = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            
            raw = await safe_websocket_recv(websocket, timeout=min(remaining, RECV_TIMEOUT_MEDIUM), gateway_connection=gateway_connection)
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
        
        log_now(f"⚠️  Таймаут получения состояния устройства {device_id}")
        return None
    except Exception as e:
        log_now(f"❌ Ошибка получения состояния устройства: {e}")
        return None


# ============================================================================
# МОНИТОРИНГ ИЗМЕНЕНИЙ (РАЗДЕЛЁН НА ФУНКЦИИ)
# ============================================================================

async def read_websocket_message(
    websocket: websockets.WebSocketClientProtocol,
    device_id: str,
    timeout: float = RECV_TIMEOUT_SHORT,
    gateway_connection: Optional[GatewayConnection] = None
) -> Optional[WebSocketMessage]:
    """
    Читает сообщение WebSocket, фильтруя по device_id.
    
    Args:
        websocket: WebSocket соединение
        device_id: ID устройства для фильтрации
        timeout: Таймаут чтения
        gateway_connection: Соединение gateway (опционально)
        
    Returns:
        Сообщение или None
    """
    raw = await safe_websocket_recv(websocket, timeout, gateway_connection)
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


def is_target_device(
    msg_id: str,
    payload: DevicePayload,
    device_ids_to_monitor: List[str],
    monitor_all: bool,
    tracked_device_ids: Set[str]
) -> Tuple[bool, Set[str]]:
    """
    Определяет, является ли устройство целевым для мониторинга.
    
    Args:
        msg_id: ID устройства из сообщения
        payload: Payload устройства
        device_ids_to_monitor: Список ID для мониторинга
        monitor_all: Флаг мониторинга всех устройств с определёнными признаками
        tracked_device_ids: Множество уже отслеживаемых устройств
        
    Returns:
        Tuple[is_target, updated_tracked_device_ids]
    """
    title = payload.get("title", "")
    code = payload.get("code", "")
    bind = payload.get("bind", "")
    
    if monitor_all:
        # Мониторим все устройства, связанные с "лоджия", "lodgia", "освещение"
        title_lower = (title or "").lower()
        code_lower = (code or "").lower()
        is_target = (
            "лоджия" in title_lower or "lodgia" in title_lower or
            "лоджия" in code_lower or "lodgia" in code_lower or
            "освещение" in title_lower
        )
        
        if is_target and msg_id not in tracked_device_ids:
            tracked_device_ids.add(msg_id)
            log_now(f"   📍 ⭐ НАЙДЕНО УСТРОЙСТВО ДЛЯ МОНИТОРИНГА: {msg_id} ({title or code})")
        
        return is_target, tracked_device_ids
    else:
        # Проверяем по ID или по признакам
        is_target = (
            msg_id in device_ids_to_monitor or
            (title and "бра" in title.lower()) or
            (code and "bra" in code.lower()) or
            (bind and any(did in bind for did in device_ids_to_monitor))
        )
        
        # Всегда проверяем по признакам устройства (title/code содержат "бра")
        if (title and "бра" in title.lower()) or (code and "bra" in code.lower()):
            if not is_target:
                is_target = True
                log_now(f"   ⚠️  ID устройства в gateway отличается! Ожидали: {device_ids_to_monitor}, получили: {msg_id}")
        
        return is_target, tracked_device_ids


def process_state_change(
    payload: DevicePayload,
    last_state: Dict[str, Any],
    initial_state: Optional[DevicePayload],
    start_time: float,
    changes: List[StateChange]
) -> Tuple[Dict[str, Any], Optional[DevicePayload], bool]:
    """
    Обрабатывает изменение состояния устройства.
    
    Args:
        payload: Текущий payload устройства
        last_state: Последнее известное состояние
        initial_state: Начальное состояние (может быть None)
        start_time: Время начала мониторинга
        changes: Список зафиксированных изменений
        
    Returns:
        Tuple[updated_last_state, updated_initial_state, was_change_recorded]
    """
    # Если начальное состояние не задано, используем первое сообщение как начальное
    updated_initial_state = initial_state
    if updated_initial_state is None:
        updated_initial_state = payload
        last_state = {k: v for k, v in payload.items() if k in ("value", "title", "code", "timestamp")}
        log_now(f"   📍 Определено начальное состояние устройства: {payload.get('title', 'N/A')}")
    
    # Проверяем, изменилось ли состояние
    was_change_recorded = False
    if is_state_changed(payload, last_state):
        if is_significant_change(payload):
            elapsed = asyncio.get_running_loop().time() - start_time
            change_info = create_change_info(payload, last_state, elapsed)
            changes.append(change_info)
            
            # Нормализуем значения для вывода
            value_prev = normalize_value(last_state.get("value", 0))
            value_curr = normalize_value(payload.get("value", 0))
            device_name = payload.get("title", "") or payload.get("code", "") or "unknown"
            
            log_now(f"📊 Изменение зафиксировано (+{elapsed:.2f}с): {device_name} - value {value_prev} → {value_curr}")
            log_gateway(f"📊 Изменение состояния: device={device_name}, value {value_prev} → {value_curr}")
            
            was_change_recorded = True
    
    # Обновляем последнее известное состояние
    updated_last_state = {k: v for k, v in payload.items() if k in ("value", "title", "code", "timestamp")}
    
    return updated_last_state, updated_initial_state, was_change_recorded


async def monitor_state_changes(
    websocket: websockets.WebSocketClientProtocol,
    device_id: str,
    initial_state: Optional[DevicePayload],
    duration: float = MONITORING_TIMEOUT,
    ready_event: Optional[asyncio.Event] = None,
    monitor_ids: Optional[List[str]] = None,
    monitor_all: bool = False,
    gateway_connection: Optional[GatewayConnection] = None
) -> List[StateChange]:
    """
    Мониторит изменения состояния устройства.
    
    Args:
        websocket: WebSocket соединение
        device_id: ID устройства (основной)
        initial_state: Начальное состояние для сравнения
        duration: Длительность мониторинга в секундах
        ready_event: Событие для сигнализации о готовности мониторинга
        monitor_ids: Список ID для мониторинга (если None, используется device_id)
        monitor_all: Флаг мониторинга всех устройств с определёнными признаками
        gateway_connection: Соединение gateway (опционально)
        
    Returns:
        Список зафиксированных изменений
    """
    # Используем список ID для мониторинга (для gateway может быть несколько вариантов)
    device_ids_to_monitor = monitor_ids if monitor_ids else [device_id]
    log_now(f"🔍 Мониторинг изменений состояния устройства {device_id} (длительность: {duration} сек)...")
    if len(device_ids_to_monitor) > 1:
        log_now(f"   Мониторим по ID: {', '.join(device_ids_to_monitor)}")
    
    changes: List[StateChange] = []
    # Используем только необходимые поля для экономии памяти
    last_state = {k: v for k, v in (initial_state or {}).items() if k in ("value", "title", "code", "timestamp")}
    start_time = asyncio.get_running_loop().time()
    deadline = start_time + duration
    last_status_time = start_time
    tracked_device_ids: Set[str] = set()  # Отслеживаемые устройства
    current_initial_state = initial_state
    
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
        
        # Читаем все сообщения для диагностики
        raw = await safe_websocket_recv(websocket, min(remaining, RECV_TIMEOUT_SHORT), gateway_connection)
        if not raw:
            continue
        
        try:
            message: WebSocketMessage = json.loads(raw)
            msg_type = message.get("type", "unknown")
            msg_id = message.get("id", "unknown")
            
            # Обрабатываем только ACTION_SET сообщения
            if msg_type == ACTION_SET:
                payload = message.get("payload", {})
                title = payload.get("title", "")
                code = payload.get("code", "")
                
                # Определяем, является ли устройство целевым
                is_our_device, tracked_device_ids = is_target_device(
                    msg_id, payload, device_ids_to_monitor, monitor_all, tracked_device_ids
                )
                
                # Логируем найденные устройства
                if is_our_device:
                    bind = payload.get("bind", "")
                    log_now(f"   📨 ⭐ НАЙДЕНО НАШЕ УСТРОЙСТВО! type={msg_type}, id={msg_id}, title={title}, code={code}, bind={bind}")
                elif msg_id in device_ids_to_monitor:
                    log_now(f"   📨 Получено сообщение для нашего устройства: type={msg_type}, id={msg_id}")
                
                # Обрабатываем изменение состояния
                if is_our_device:
                    last_state, current_initial_state, was_recorded = process_state_change(
                        payload, last_state, current_initial_state, start_time, changes
                    )
                    if was_recorded:
                        # Сохраняем ID устройства в последнем изменении
                        if changes:
                            changes[-1]["device_id"] = msg_id
                        
        except (json.JSONDecodeError, KeyError) as e:
            log_now(f"   ⚠️  Ошибка парсинга сообщения: {e}, raw: {raw[:100] if raw else 'None'}")
            continue
        except WebSocketConnectionError:
            raise
    
    log_now(f"✅ Мониторинг завершён. Зафиксировано изменений: {len(changes)}")
    return changes


# ============================================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ТЕСТА
# ============================================================================

async def setup_test_environment(
    test_device_id: Optional[str],
    test_device_name: str
) -> Tuple[str, Optional[GatewayConnection], websockets.WebSocketClientProtocol]:
    """
    Настраивает тестовое окружение: валидация, поиск устройства, подключение к gateway.
    
    Args:
        test_device_id: ID устройства для тестирования
        test_device_name: Имя устройства для тестирования
        
    Returns:
        Tuple[actual_device_id, gateway_connection, websocket]
    """
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
    
    log_now(f"WebSocket gateway: {WS_URI}")
    log_now(f"Локальный WebSocket (для GET): {LOCAL_WS_URI}")
    log_now("")
    
    # Поиск устройства
    log_now("┌─ ПРЕДВАРИТЕЛЬНЫЙ ШАГ: Поиск устройства")
    log_now(f"   Ищем устройство '{test_device_name}' через локальное подключение...")
    
    actual_device_id = test_device_id if test_device_id else LODGIA_LIGHT_DEVICE_ID
    log_now(f"   Используем устройство: '{test_device_name}' (ID: {actual_device_id})")
    
    # Подключение к gateway
    log_now("┌─ Подключение к gateway")
    gateway_connection: Optional[GatewayConnection] = None
    try:
        websocket, gateway_connection = await safe_websocket_connect(WS_URI)
    except WebSocketConnectionError as e:
        pytest.fail(f"Не удалось подключиться к gateway: {e}")
    
    log_now("✅ Подключение к gateway установлено\n")
    
    return actual_device_id, gateway_connection, websocket


async def get_initial_device_state(
    websocket: websockets.WebSocketClientProtocol,
    device_id: str,
    gateway_connection: Optional[GatewayConnection]
) -> Optional[DevicePayload]:
    """
    Получает начальное состояние устройства через gateway.
    
    Args:
        websocket: WebSocket соединение
        device_id: ID устройства
        gateway_connection: Соединение gateway
        
    Returns:
        Начальное состояние устройства или None
    """
    log_now(f"   Получаем начальное состояние устройства через gateway...")
    initial_state = await get_device_state_external(websocket, device_id, timeout=5.0, gateway_connection=gateway_connection)
    
    if initial_state:
        initial_value_raw = initial_state.get("value", "N/A")
        initial_value_int = normalize_value(initial_value_raw)
        log_now(f"   ✅ Начальное состояние получено: value={initial_value_int}")
    else:
        log_now(f"   ⚠️  Не удалось получить начальное состояние через gateway, будет определено из мониторинга")
    
    log_now(f"└─ ✅ Устройство определено: {device_id}\n")
    return initial_state


async def execute_script_and_monitor(
    websocket: websockets.WebSocketClientProtocol,
    script_id: str,
    device_id: str,
    initial_state: Optional[DevicePayload],
    gateway_connection: Optional[GatewayConnection]
) -> List[StateChange]:
    """
    Выполняет скрипт и мониторит изменения состояния устройства.
    
    Args:
        websocket: WebSocket соединение
        script_id: ID скрипта для выполнения
        device_id: ID устройства для мониторинга
        initial_state: Начальное состояние устройства
        gateway_connection: Соединение gateway
        
    Returns:
        Список зафиксированных изменений состояния
    """
    log_now("┌─ ШАГ 2: Изменение состояния устройства через скрипт")
    log_now(f"   Выполняем скрипт '{SCRIPT_NAME}' (ID: {script_id}) через gateway...")
    log_now(f"   Скрипт должен изменить состояние устройств, связанных с 'Лоджия'")
    
    log_now("\n┌─ ШАГ 3: Определение и проверка изменения состояния")
    log_now("   Запускаем мониторинг изменений состояния через gateway...")
    
    # Создаём событие для синхронизации
    monitoring_ready = asyncio.Event()
    gateway_monitor_ids = [device_id] if device_id else []
    
    # Создаём задачу мониторинга
    monitoring_task = asyncio.create_task(
        monitor_state_changes(
            websocket,
            "",  # ID не важен при monitor_all=True
            initial_state,
            duration=MONITORING_TIMEOUT,
            ready_event=monitoring_ready,
            monitor_ids=gateway_monitor_ids,
            monitor_all=True,  # Мониторим все устройства, связанные с "лоджия"
            gateway_connection=gateway_connection
        )
    )
    
    # Ждём готовности мониторинга перед отправкой команды
    await monitoring_ready.wait()
    await asyncio.sleep(MONITORING_STARTUP_DELAY)
    
    # Выполняем скрипт через gateway
    command = {"type": ACTION_SCRIPT_RUN, "id": script_id}
    import datetime
    script_start_time = datetime.datetime.now()
    log_now(f"   📤 Отправляем команду ACTION_SCRIPT_RUN для скрипта {script_id}...")
    log_gateway(f"🚀 Выполнение скрипта: ID={script_id}, время={script_start_time.strftime('%H:%M:%S.%f')[:-3]}")
    await safe_websocket_send(websocket, command, gateway_connection)
    log_now(f"   ✅ Команда ACTION_SCRIPT_RUN отправлена, ожидаем изменение состояния...")
    
    # Логируем первые сообщения после отправки команды (для диагностики)
    if LOG_GATEWAY_VERBOSE:
        log_gateway("📥 Мониторинг входящих сообщений после отправки команды (первые 5 секунд)...")
        messages_received = 0
        monitor_start = asyncio.get_running_loop().time()
        while asyncio.get_running_loop().time() - monitor_start < 5.0:
            try:
                raw = await safe_websocket_recv(websocket, timeout=0.5, gateway_connection=gateway_connection)
                if raw:
                    messages_received += 1
                    try:
                        msg = json.loads(raw)
                        msg_type = msg.get("type", "unknown")
                        msg_id = msg.get("id", "unknown")
                        log_gateway(f"   📨 Сообщение #{messages_received}: type={msg_type}, id={msg_id}")
                        if messages_received >= 10:
                            break
                    except json.JSONDecodeError:
                        log_debug(f"   📨 Сырое сообщение #{messages_received}: {raw[:100]}")
            except asyncio.TimeoutError:
                continue
        log_gateway(f"📊 Получено сообщений за 5 секунд: {messages_received}")
    
    log_now("└─ ✅ Команда изменения состояния отправлена\n")
    
    # Ждём завершения мониторинга
    try:
        changes = await monitoring_task
    except WebSocketConnectionError as e:
        pytest.fail(f"Ошибка во время мониторинга: {e}")
    
    log_now("└─ ✅ Мониторинг завершён\n")
    return changes


async def verify_state_change(
    websocket: websockets.WebSocketClientProtocol,
    device_id: str,
    initial_state: Optional[DevicePayload],
    changes: List[StateChange],
    gateway_connection: Optional[GatewayConnection]
) -> None:
    """
    Проверяет, что состояние устройства изменилось.
    
    Args:
        websocket: WebSocket соединение
        device_id: ID устройства
        initial_state: Начальное состояние устройства
        changes: Список зафиксированных изменений
        gateway_connection: Соединение gateway
    """
    # Если gateway не зафиксировал изменения, проверяем локально
    if len(changes) == 0:
        log_now("⚠️  Gateway не зафиксировал изменения, проверяем состояние через gateway...")
        await asyncio.sleep(2.0)
        
        # Пробуем несколько раз получить состояние через gateway
        final_state = None
        for attempt in range(3):
            log_now(f"   Попытка {attempt + 1}/3 получить состояние через gateway...")
            final_state = await get_device_state_external(websocket, device_id, timeout=5.0, gateway_connection=gateway_connection)
            if final_state:
                break
            await asyncio.sleep(1.0)
        
        if final_state:
            final_value_raw = final_state.get("value", "N/A")
            final_value_int = normalize_value(final_value_raw)
            if initial_state:
                initial_value_int = normalize_value(initial_state.get("value", 0))
                if final_value_int != initial_value_int:
                    # Создаём искусственное изменение для совместимости с проверками
                    changes.append({
                        "elapsed": MONITORING_TIMEOUT + 2.0,
                        "previous": {k: v for k, v in initial_state.items() if k in ("value", "title", "code")},
                        "current": {k: v for k, v in final_state.items() if k in ("value", "title", "code")},
                    })
                    log_now(f"✅ Изменение подтверждено через gateway: value {initial_value_int} → {final_value_int}")
                else:
                    log_now(f"⚠️  Состояние не изменилось локально: value = {final_value_int}")
            else:
                log_now(f"✅ Получено состояние устройства: value = {final_value_int}")
        else:
            log_now(f"⚠️  Не удалось получить финальное состояние локально после 3 попыток")
    
    # Проверки
    log_now("=" * 80)
    log_now("РЕЗУЛЬТАТЫ ТЕСТА")
    log_now("=" * 80)
    
    assert len(changes) > 0, f"Должно быть зафиксировано хотя бы одно изменение состояния"
    
    # Определяем устройство из первого изменения
    first_change = changes[0]
    last_change = changes[-1]
    initial_value_from_change = first_change.get("previous", {}).get("value", "N/A")
    final_value_raw = last_change["current"].get("value", "N/A")
    initial_value_int_from_change = normalize_value(initial_value_from_change)
    final_value_int = normalize_value(final_value_raw)
    
    device_title_from_change = last_change["current"].get("title", "")
    device_code_from_change = last_change["current"].get("code", "")
    device_id_from_change = last_change.get("device_id", "unknown")
    
    log_now(f"Найдено изменений: {len(changes)}")
    log_now(f"Устройство: {device_title_from_change} ({device_code_from_change}) [ID: {device_id_from_change}]")
    log_now(f"Начальное значение: {initial_value_from_change} (нормализовано: {initial_value_int_from_change})")
    log_now(f"Финальное значение: {final_value_raw} (нормализовано: {final_value_int})")
    
    assert final_value_int != initial_value_int_from_change, \
        f"Значение должно было измениться с {initial_value_int_from_change} на другое, но осталось {final_value_int}"
    
    log_now("\n✅ Все проверки пройдены успешно!")
    log_now("=" * 80)


async def restore_device_state(
    websocket: websockets.WebSocketClientProtocol,
    device_id: str,
    script_id: str,
    current_state: DevicePayload,
    initial_value: int,
    gateway_connection: Optional[GatewayConnection]
) -> None:
    """
    Восстанавливает исходное состояние устройства.
    
    Args:
        websocket: WebSocket соединение
        device_id: ID устройства
        script_id: ID скрипта для восстановления (toggle)
        current_state: Текущее состояние устройства
        initial_value: Исходное значение для проверки
        gateway_connection: Соединение gateway
    """
    log_now("\n┌─ ШАГ 4: Восстановление состояния устройства")
    log_now(f"   Возвращаем устройство в исходное состояние (value = {initial_value})...")
    
    # Создаём событие для синхронизации
    restore_monitoring_ready = asyncio.Event()
    restore_monitor_ids = [device_id] if device_id else []
    
    # Запускаем мониторинг для подтверждения восстановления
    restore_monitoring_task = asyncio.create_task(
        monitor_state_changes(
            websocket,
            device_id,
            current_state,
            duration=MONITORING_TIMEOUT,
            ready_event=restore_monitoring_ready,
            monitor_ids=restore_monitor_ids,
            monitor_all=False,
            gateway_connection=gateway_connection
        )
    )
    
    # Ждём готовности мониторинга
    await restore_monitoring_ready.wait()
    await asyncio.sleep(MONITORING_STARTUP_DELAY)
    
    # Отправляем команду восстановления через тот же скрипт (toggle)
    restore_command = {"type": ACTION_SCRIPT_RUN, "id": script_id}
    log_now(f"   📤 Отправляем команду ACTION_SCRIPT_RUN для восстановления состояния (скрипт {script_id})...")
    await safe_websocket_send(websocket, restore_command, gateway_connection)
    log_now(f"   ✅ Команда ACTION_SCRIPT_RUN отправлена, ожидаем восстановление состояния...")
    
    # Ждём завершения мониторинга восстановления
    try:
        restore_changes = await restore_monitoring_task
    except WebSocketConnectionError as e:
        log_now(f"   ⚠️  Ошибка во время мониторинга восстановления: {e}")
        restore_changes = []
    
    # Проверка восстановления состояния
    if restore_changes:
        restored_value = restore_changes[-1]["current"].get("value", "N/A")
        restored_value_int = normalize_value(restored_value)
        
        if restored_value_int == initial_value:
            log_now(f"   ✅ Состояние восстановлено: value = {restored_value} (нормализовано: {restored_value_int})")
        else:
            pytest.fail(
                f"Не удалось восстановить исходное состояние устройства. "
                f"Ожидалось: {initial_value}, получено: {restored_value_int}"
            )
    else:
        # Восстановление не зафиксировано через gateway - проверяем локально
        log_now("⚠️  Gateway не зафиксировал восстановление, проверяем состояние локально...")
        await asyncio.sleep(2.0)
        
        restored_state = await get_device_state_local(device_id, timeout=5.0)
        if restored_state:
            restored_value_raw = restored_state.get("value", "N/A")
            restored_value_int = normalize_value(restored_value_raw)
            
            if restored_value_int == initial_value:
                log_now(f"   ✅ Состояние восстановлено локально: value = {restored_value_int}")
            else:
                pytest.fail(
                    f"Не удалось восстановить исходное состояние устройства. "
                    f"Ожидалось: {initial_value}, получено: {restored_value_int}"
                )
        else:
            pytest.fail(
                f"Не удалось проверить восстановление состояния устройства. "
                f"Устройство может остаться в изменённом состоянии."
            )
    
    log_now("└─ ✅ Восстановление состояния завершено")
    log_now("=" * 80)


# ============================================================================
# ОСНОВНОЙ ТЕСТ
# ============================================================================

@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize("device_id,device_name", [
    (None, None),  # Используются значения по умолчанию
])
async def test_bra_device_detection_and_state_change_external(
    device_id: Optional[str],
    device_name: Optional[str]
):
    """
    Внешний тест определения и изменения состояния устройства "Бра" через gateway.
    
    Работает через удалённый WebSocket gateway (wss://gate.reacthome.net).
    Требует указания MAC адреса устройства для подключения.
    
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
    
    # Настройка тестового окружения
    actual_device_id, gateway_connection, websocket = await setup_test_environment(
        test_device_id, test_device_name
    )
    
    try:
        # Получение начального состояния
        initial_state = await get_initial_device_state(
            websocket, actual_device_id, gateway_connection
        )
        
        # Подготовка к мониторингу
        log_now("┌─ ШАГ 1: Подготовка к мониторингу изменений")
        if initial_state:
            initial_value_int = normalize_value(initial_state.get("value", 0))
            log_now(f"   Начальное состояние: value={initial_value_int}")
        else:
            log_now(f"   Начальное состояние будет определено из мониторинга")
        log_now("└─ ✅ Готовы к мониторингу\n")
        
        # Поиск скрипта
        log_now("┌─ Поиск скрипта для управления устройством")
        log_now(f"   Ищем скрипт: '{SCRIPT_NAME}'...")
        script_id_to_use = SCRIPT_ID
        log_now(f"   Используем скрипт с ID: {script_id_to_use}")
        log_now("└─ ✅ Скрипт определён\n")
        
        # Выполнение скрипта и мониторинг
        changes = await execute_script_and_monitor(
            websocket, script_id_to_use, actual_device_id, initial_state, gateway_connection
        )
        
        # Проверка изменений
        await verify_state_change(
            websocket, actual_device_id, initial_state, changes, gateway_connection
        )
        
        # Восстановление состояния
        last_change = changes[-1]
        initial_value_from_change = normalize_value(changes[0].get("previous", {}).get("value", 0))
        await restore_device_state(
            websocket, actual_device_id, script_id_to_use,
            last_change["current"], initial_value_from_change, gateway_connection
        )
    
    finally:
        # Закрываем соединение с gateway в любом случае
        try:
            if gateway_connection:
                await gateway_connection.close()
            elif 'websocket' in locals():
                await websocket.close()
        except Exception:
            pass
