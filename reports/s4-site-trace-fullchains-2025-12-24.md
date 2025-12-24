# Полные цепочки по site → trace_id (SOURCE/SCRIPT/CONSUMER/ACTUATOR)
Источник: `logs/logger/events/events-2025-12-24.jsonl`, `logger_pid=80520`
Выборка: **41 trace_id** из отчёта `reports/s4-gestures-order-2025-12-24.md`

Тип нажатия по документации:
- `click`/`press` → `onClick[]`
- `double_click` → `onClick2[]`
- `hold`/`dimming` → `onHold[]`

Формат шага:
- SOURCE: **время → human → click_kind → di/N → expected_trigger**
- прочие: **время → ROLE → human**

## Site: Гостиная

### trace_id: e9decbff-a6ab-42ba-9eb1-037ddd116860

- 08:44:12.243 → S4 Гостиная → dimming → di/1 → onHold
- 08:44:12.501 → S4 Кухня → dimming → di/6 → onHold
- 08:44:14.224 → SCRIPT → Досуг гост тв Toggle
- 08:44:14.225 → SCRIPT → Досуг гост тв on
- 08:44:14.226 → SCRIPT → Ужин
- 08:44:14.227 → CONSUMER → Подсветка окна кухни/9.D.LED.23
- 08:44:14.227 → CONSUMER → Подсветка окна гостиной/9.D.LED.25
- 08:44:14.231 → ACTUATOR → Dim6 / dim/6
- 08:44:14.232 → ACTUATOR → Dim6 / dim/5

## Site: Душ

### trace_id: 1b083014-5820-4388-a316-1f7ae8089f17 (⚠ нет CONSUMER)

- 08:38:52.376 → S4 Душ → click → di/2 → onClick
- 08:38:53.861 → S4 Душ → dimming → di/2 → onHold
- 08:38:57.038 → S4 Душ → click → di/4 → onClick
- 08:39:02.600 → SCRIPT → 2.D.LED.6 toggle

## Site: Коридор

### trace_id: 438b4b6e-a305-4e70-b631-e2851ea58a0e (⚠ нет CONSUMER)

- 08:52:42.673 → S4 Коридор → click → di/3 → onClick
- 08:52:47.175 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:52:47.176 → SCRIPT → 3.D.TREK.3\4 off
- 08:52:47.177 → SCRIPT → light on night коридор

### trace_id: 1e6a41fe-1e97-4157-a3e0-a6093b2cba62 (⚠ нет CONSUMER)

- 08:51:27.504 → S4 Коридор → dimming → di/1 → onHold
- 08:51:27.843 → S4 Прихожая → click → di/2 → onClick
- 08:51:28.869 → S4 Коридор → click → di/2 → onClick
- 08:51:28.977 → S4 Прихожая → dimming → di/5 → onHold
- 08:51:29.967 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:51:29.968 → SCRIPT → 3.D.TREK.3\4 on
- 08:51:29.969 → SCRIPT → light on night коридор
- 08:51:30.099 → S4 Коридор → click → di/2 → onClick
- 08:51:32.542 → S4 Коридор → dimming → di/3 → onHold
- 08:51:32.560 → S4 Прихожая → dimming → di/7 → onHold
- 08:51:33.550 → SCRIPT → light on night коридор
- 08:51:33.555 → ACTUATOR → D7 / dim/3
- 08:51:34.543 → SCRIPT → light on night коридор
- 08:51:34.547 → ACTUATOR → D7 / dim/3
- 08:51:35.536 → SCRIPT → light on night коридор
- 08:51:35.539 → ACTUATOR → D7 / dim/3
- 08:51:37.522 → SCRIPT → light on night коридор
- 08:51:37.526 → ACTUATOR → D7 / dim/3
- 08:51:39.160 → S4 Коридор → dimming → di/5 → onHold
- 08:51:39.235 → S4 Прихожая → dimming → di/5 → onHold
- 08:51:40.224 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:51:40.225 → SCRIPT → 3.D.TREK.3\4 on
- 08:51:40.226 → SCRIPT → light on night коридор
- 08:51:41.221 → SCRIPT → light on night коридор
- 08:51:41.226 → ACTUATOR → D7 / dim/3
- 08:51:42.214 → SCRIPT → light on night коридор
- 08:51:42.218 → ACTUATOR → D7 / dim/3
- 08:51:43.207 → SCRIPT → light on night коридор
- 08:51:43.210 → ACTUATOR → D7 / dim/3
- 08:51:44.200 → SCRIPT → light on night коридор
- 08:51:44.205 → ACTUATOR → D7 / dim/3
- 08:51:45.193 → SCRIPT → light on night коридор
- 08:51:45.196 → ACTUATOR → D7 / dim/3
- 08:51:46.186 → SCRIPT → light on night коридор
- 08:51:46.188 → ACTUATOR → D7 / dim/3
- 08:51:47.179 → SCRIPT → light on night коридор
- 08:51:47.183 → ACTUATOR → D7 / dim/3
- 08:51:53.051 → S4 Прихожая → click → di/2 → onClick

### trace_id: ff1bb210-e87c-424f-8417-d5572e60d388 (⚠ нет CONSUMER)

- 08:49:17.326 → S4 Коридор → dimming → di/1 → onHold
- 08:49:27.478 → S4 Коридор → click → di/2 → onClick
- 08:49:28.676 → S4 Прихожая → click → di/3 → onClick
- 08:49:30.701 → S4 Коридор → dimming → di/2 → onHold
- 08:49:30.800 → S4 Прихожая → dimming → di/2 → onHold
- 08:49:31.789 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:49:31.790 → SCRIPT → 3.D.TREK.3\4 on
- 08:49:31.791 → SCRIPT → light on night коридор
- 08:49:32.787 → SCRIPT → light on night коридор
- 08:49:32.791 → ACTUATOR → D7 / dim/3
- 08:49:35.064 → S4 Прихожая → dimming → di/? → onHold
- 08:49:35.899 → S4 Коридор → click → di/4 → onClick
- 08:49:36.055 → SCRIPT → light on night коридор
- 08:49:36.059 → ACTUATOR → D7 / dim/3
- 08:49:37.541 → S4 Прихожая → dimming → di/2 → onHold
- 08:49:38.062 → S4 Коридор → dimming → di/4 → onHold
- 08:49:38.534 → SCRIPT → light on night коридор
- 08:49:38.537 → ACTUATOR → D7 / dim/3
- 08:49:39.523 → SCRIPT → light on night коридор
- 08:49:39.526 → ACTUATOR → D7 / dim/3
- 08:49:41.012 → S4 Прихожая → dimming → di/6 → onHold
- 08:49:41.219 → S4 Коридор → dimming → di/3 → onHold
- 08:49:41.999 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:49:42.000 → SCRIPT → 3.D.TREK.3\4 on
- 08:49:42.001 → SCRIPT → light on night коридор
- 08:49:43.361 → S4 Прихожая → dimming → di/2 → onHold
- 08:49:45.347 → SCRIPT → light on night коридор
- 08:49:45.350 → ACTUATOR → D7 / dim/3
- 08:49:46.339 → SCRIPT → light on night коридор
- 08:49:46.343 → ACTUATOR → D7 / dim/3
- 08:49:48.588 → S4 Прихожая → dimming → di/5 → onHold
- 08:49:49.167 → S4 Коридор → dimming → di/3 → onHold
- 08:49:49.582 → SCRIPT → light on night коридор
- 08:49:49.586 → ACTUATOR → D7 / dim/3

### trace_id: 311acf89-43c7-471c-af65-2bf22fa01ca1

- 08:48:36.665 → S4 Коридор → dimming → di/4 → onHold
- 08:48:39.287 → S4 Коридор → dimming → di/4 → onHold
- 08:48:39.800 → S4 Прихожая → dimming → di/2 → onHold
- 08:48:40.790 → SCRIPT → 3.D.TREK.3\4 on
- 08:48:40.791 → SCRIPT → light on night коридор
- 08:48:40.792 → CONSUMER → Прихожая трек/3.D.TREK.3 Прихожая
- 08:48:40.795 → ACTUATOR → D7 / dim/3
- 08:48:42.430 → S4 Коридор → dimming → di/6 → onHold
- 08:48:45.082 → S4 Коридор → click → di/3 → onClick
- 08:48:45.412 → S4 Прихожая → dimming → di/2 → onHold
- 08:48:46.180 → S4 Коридор → dimming → di/2 → onHold
- 08:48:47.394 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:48:47.395 → SCRIPT → light on night коридор
- 08:48:48.391 → SCRIPT → light on night коридор
- 08:48:48.396 → ACTUATOR → D7 / dim/3
- 08:48:49.717 → S4 Коридор → dimming → di/2 → onHold
- 08:48:50.122 → S4 Прихожая → dimming → di/7 → onHold
- 08:48:51.115 → SCRIPT → 3.D.TREK.3\4 on
- 08:48:51.116 → SCRIPT → light on night коридор
- 08:48:51.120 → ACTUATOR → D7 / dim/3
- 08:48:52.334 → S4 Коридор → click → di/2 → onClick
- 08:48:53.021 → S4 Прихожая → click → di/5 → onClick

### trace_id: fa9470b0-8cc9-4931-b5ba-3fd003c1eba5 (⚠ нет CONSUMER)

- 08:48:28.177 → S4 Коридор → dimming → di/2 → onHold
- 08:48:34.570 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:48:34.571 → SCRIPT → 3.D.TREK.3\4 off
- 08:48:34.572 → SCRIPT → light on night коридор

### trace_id: f661ea29-7df1-4bca-8fe4-e248dc8ffbf3 (⚠ нет CONSUMER)

- 08:47:48.123 → S4 Коридор → click → di/2 → onClick
- 08:47:50.403 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:47:51.090 → S4 Коридор → dimming → di/4 → onHold

### trace_id: 0e03fb22-16d8-4ac8-a657-8fafee338483 (⚠ нет CONSUMER)

- 08:47:43.433 → S4 Коридор → click → di/4 → onClick
- 08:47:43.511 → S4 Прихожая → click → di/2 → onClick
- 08:47:45.230 → S4 Коридор → click → di/4 → onClick
- 08:47:45.401 → SCRIPT → 3.D.TREK.3\4 on
- 08:47:45.404 → ACTUATOR → D7 / dim/4

### trace_id: 1bb01922-dc04-47e6-8919-4826ef1646ca (⚠ нет CONSUMER)

- 08:47:24.678 → S4 Коридор → dimming → di/? → onHold
- 08:47:25.404 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:47:30.402 → SCRIPT → 3.D.TREK.3\4 on
- 08:47:30.405 → ACTUATOR → D7 / dim/4
- 08:47:36.598 → S4 Коридор → click → di/3 → onClick
- 08:47:38.914 → S4 Коридор → dimming → di/5 → onHold
- 08:47:40.399 → SCRIPT → 3.D.TREK.3\4 toggle1

### trace_id: e8179019-745c-4eff-b644-961337b7a659 (⚠ нет CONSUMER)

- 08:46:12.897 → S4 Коридор → dimming → di/4 → onHold
- 08:46:15.027 → S4 Коридор → dimming → di/3 → onHold
- 08:46:15.399 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:46:15.400 → SCRIPT → 3.D.TREK.3\4 on
- 08:46:20.404 → ACTUATOR → D7 / dim/4

### trace_id: 26a8cc41-01f7-4e22-b141-b89ecf637269 (⚠ нет CONSUMER)

- 08:41:11.699 → S4 Коридор → click → di/2 → onClick
- 08:41:11.768 → S4 Прихожая → click → di/2 → onClick
- 08:41:13.755 → S4 Прихожая → dimming → di/1 → onHold
- 08:41:15.399 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:41:15.400 → SCRIPT → 3.D.TREK.3\4 on
- 08:41:19.844 → S4 Прихожая → dimming → di/5 → onHold
- 08:41:30.399 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:41:30.400 → SCRIPT → 3.D.TREK.3\4 on
- 08:41:34.659 → S4 Коридор → click → di/2 → onClick
- 08:41:35.406 → ACTUATOR → D7 / dim/4
- 08:41:41.570 → S4 Коридор → click → di/2 → onClick
- 08:41:42.788 → S4 Прихожая → click → di/2 → onClick
- 08:41:43.970 → S4 Прихожая → click → di/3 → onClick
- 08:41:45.398 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:41:45.399 → SCRIPT → 3.D.TREK.3\4 on
- 08:41:45.668 → S4 Прихожая → dimming → di/? → onHold
- 08:41:49.713 → S4 Прихожая → click → di/2 → onClick
- 08:41:50.405 → ACTUATOR → D7 / dim/4
- 08:41:51.695 → S4 Прихожая → click → di/3 → onClick
- 08:41:52.499 → S4 Коридор → dimming → di/1 → onHold
- 08:41:53.681 → S4 Прихожая → dimming → di/1 → onHold
- 08:41:53.825 → S4 Коридор → click → di/2 → onClick
- 08:41:55.399 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:41:55.400 → SCRIPT → 3.D.TREK.3\4 on

### trace_id: 234bf72f-c462-4d41-902b-64300082279a (⚠ нет CONSUMER)

- 08:40:56.988 → S4 Коридор → click → di/2 → onClick
- 08:40:58.626 → S4 Прихожая → click → di/2 → onClick
- 08:41:00.541 → S4 Прихожая → dimming → di/2 → onHold
- 08:41:03.162 → S4 Прихожая → dimming → di/2 → onHold
- 08:41:05.398 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:41:05.399 → SCRIPT → 3.D.TREK.3\4 on
- 08:41:06.140 → S4 Прихожая → dimming → di/1 → onHold
- 08:41:10.405 → ACTUATOR → D7 / dim/4

## Site: Лоджия

### trace_id: 6646b745-7b63-4276-b2e7-c194eeaec893 (⚠ нет CONSUMER)

- 08:42:13.300 → SCRIPT → Start
- 08:42:13.300 → SCRIPT → Trigger Change state приточка
- 08:42:13.301 → S4 Лоджия → press → di/2 → onClick

## Site: Младшая

### trace_id: 8b5e66b3-5254-4907-bfd5-157c112129e4

- 08:40:46.953 → S4 Младшая → click → di/5 → onClick
- 08:40:46.953 → SCRIPT → 1.D.LED.1/2 Toggle
- 08:40:46.954 → SCRIPT → 1.D.LED.1/2 on
- 08:40:46.955 → CONSUMER → Подсветка кроватей/1.D.LED.1
- 08:40:46.955 → CONSUMER → Подсветка ТВ/1.D.LED.2
- 08:40:46.958 → ACTUATOR → Dim 3 / dim/5
- 08:40:46.959 → ACTUATOR → Dim 3 / dim/6

## Site: Прихожая

### trace_id: 830b5f71-b42f-4a15-845d-cb3951b7ae99 (⚠ нет CONSUMER)

- 08:51:08.437 → S4 Прихожая → dimming → di/6 → onHold
- 08:51:09.163 → S4 Коридор → click → di/2 → onClick
- 08:51:10.276 → S4 Коридор → dimming → di/2 → onHold
- 08:51:12.430 → S4 Коридор → click → di/2 → onClick
- 08:51:12.646 → S4 Прихожая → dimming → di/3 → onHold
- 08:51:13.635 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:51:13.636 → SCRIPT → 3.D.TREK.3\4 on
- 08:51:13.637 → SCRIPT → light on night коридор
- 08:51:14.158 → S4 Коридор → dimming → di/4 → onHold
- 08:51:16.000 → S4 Прихожая → dimming → di/2 → onHold
- 08:51:17.722 → S4 Коридор → dimming → di/3 → onHold

### trace_id: 12d9d636-8fd3-4fe9-993a-4bdacd87b03c (⚠ нет CONSUMER)

- 08:50:49.577 → S4 Прихожая → dimming → di/1 → onHold
- 08:50:49.835 → S4 Коридор → click → di/2 → onClick
- 08:50:50.882 → S4 Прихожая → click → di/2 → onClick
- 08:50:51.821 → S4 Коридор → dimming → di/2 → onHold
- 08:50:53.510 → S4 Прихожая → click → di/3 → onClick
- 08:50:54.095 → S4 Коридор → dimming → di/4 → onHold
- 08:50:54.635 → S4 Прихожая → dimming → di/5 → onHold
- 08:50:59.914 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:50:59.915 → SCRIPT → 3.D.TREK.3\4 on
- 08:50:59.916 → S4 Прихожая → dimming → di/? → onHold
- 08:50:59.916 → SCRIPT → light on night коридор
- 08:51:01.049 → S4 Коридор → dimming → di/6 → onHold
- 08:51:01.334 → S4 Прихожая → click → di/4 → onClick
- 08:51:03.320 → S4 Прихожая → dimming → di/8 → onHold
- 08:51:03.368 → SCRIPT → light on night коридор
- 08:51:03.371 → ACTUATOR → D7 / dim/3
- 08:51:03.461 → S4 Коридор → click → di/4 → onClick
- 08:51:04.361 → SCRIPT → light on night коридор
- 08:51:04.363 → ACTUATOR → D7 / dim/3

### trace_id: 3070665d-ad88-4f20-a0d9-4ccf7bd1ce38 (⚠ нет CONSUMER)

- 08:50:04.073 → S4 Прихожая → dimming → di/2 → onHold
- 08:50:04.586 → S4 Коридор → click → di/4 → onClick
- 08:50:06.056 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:50:06.057 → SCRIPT → 3.D.TREK.3\4 on
- 08:50:06.058 → SCRIPT → light on night коридор
- 08:50:08.024 → S4 Коридор → dimming → di/2 → onHold
- 08:50:08.294 → S4 Прихожая → dimming → di/2 → onHold
- 08:50:11.792 → S4 Прихожая → dimming → di/3 → onHold
- 08:50:11.993 → S4 Коридор → dimming → di/1 → onHold
- 08:50:14.072 → S4 Коридор → dimming → di/1 → onHold
- 08:50:14.929 → S4 Прихожая → click → di/2 → onClick
- 08:50:16.564 → S4 Прихожая → click → di/2 → onClick
- 08:50:18.369 → S4 Прихожая → dimming → di/8 → onHold
- 08:50:18.498 → S4 Коридор → click → di/3 → onClick
- 08:50:19.359 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:50:19.360 → SCRIPT → 3.D.TREK.3\4 on
- 08:50:19.361 → SCRIPT → light on night коридор

### trace_id: 070af9ad-7ca1-455f-ab8f-488ff789eed9 (⚠ нет CONSUMER)

- 08:49:53.153 → S4 Прихожая → dimming → di/2 → onHold
- 08:49:53.610 → S4 Коридор → dimming → di/2 → onHold
- 08:49:54.144 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:49:54.145 → SCRIPT → 3.D.TREK.3\4 on
- 08:49:54.146 → SCRIPT → light on night коридор
- 08:49:55.137 → SCRIPT → light on night коридор
- 08:49:55.141 → ACTUATOR → D7 / dim/3
- 08:49:56.466 → S4 Прихожая → click → di/2 → onClick
- 08:49:58.188 → S4 Коридор → dimming → di/2 → onHold
- 08:49:58.452 → S4 Прихожая → dimming → di/1 → onHold
- 08:49:59.677 → SCRIPT → light on night коридор
- 08:49:59.682 → ACTUATOR → D7 / dim/3

### trace_id: 5aafd197-3d10-46b0-8f00-804b78970cd8 (⚠ нет CONSUMER)

- 08:47:32.155 → S4 Прихожая → unknown → di/? → unknown
- 08:47:32.590 → S4 Прихожая → dimming → di/5 → onHold
- 08:47:35.405 → ACTUATOR → D7 / dim/4

### trace_id: 8cdb9cc1-71c8-4d73-93c4-640d2ca685b0 (⚠ нет CONSUMER)

- 08:46:48.737 → S4 Прихожая → click → di/3 → onClick
- 08:46:49.981 → S4 Прихожая → dimming → di/3 → onHold
- 08:46:50.398 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:46:50.399 → SCRIPT → 3.D.TREK.3\4 on
- 08:46:53.246 → S4 Прихожая → dimming → di/2 → onHold
- 08:46:55.405 → ACTUATOR → D7 / dim/4
- 08:46:57.402 → S4 Прихожая → dimming → di/2 → onHold
- 08:47:00.409 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:47:00.410 → SCRIPT → 3.D.TREK.3\4 on
- 08:47:05.406 → ACTUATOR → D7 / dim/4
- 08:47:10.405 → ACTUATOR → D7 / dim/4
- 08:47:15.399 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:47:15.400 → SCRIPT → 3.D.TREK.3\4 on

### trace_id: 5a91ef43-f2f6-4706-b462-84d2740c0718 (⚠ нет CONSUMER)

- 08:46:22.916 → S4 Прихожая → dimming → di/5 → onHold
- 08:46:25.402 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:46:30.401 → SCRIPT → 3.D.TREK.3\4 on
- 08:46:30.405 → ACTUATOR → D7 / dim/4
- 08:46:30.922 → S4 Коридор → dimming → di/? → onHold
- 08:46:35.404 → SCRIPT → 3.D.TREK.3\4 toggle1

### trace_id: 2ace6b06-1f91-49b6-b05e-59af187d4b75 (⚠ нет CONSUMER)

- 08:45:13.839 → S4 Прихожая → unknown → di/? → unknown
- 08:45:14.930 → S4 Прихожая → dimming → di/2 → onHold
- 08:45:15.398 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:45:15.399 → SCRIPT → 3.D.TREK.3\4 on
- 08:45:20.405 → ACTUATOR → D7 / dim/4
- 08:45:23.458 → S4 Коридор → dimming → di/1 → onHold
- 08:45:24.114 → S4 Прихожая → click → di/2 → onClick
- 08:45:24.609 → S4 Коридор → dimming → di/3 → onHold
- 08:45:25.399 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:45:25.400 → SCRIPT → 3.D.TREK.3\4 on
- 08:45:26.315 → S4 Прихожая → dimming → di/3 → onHold
- 08:45:30.404 → ACTUATOR → D7 / dim/4
- 08:45:35.149 → S4 Коридор → dimming → di/3 → onHold
- 08:45:35.403 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:45:40.401 → SCRIPT → 3.D.TREK.3\4 on
- 08:45:40.407 → ACTUATOR → D7 / dim/4
- 08:45:45.405 → ACTUATOR → D7 / dim/4
- 08:45:50.399 → SCRIPT → 3.D.TREK.3\4 toggle1

### trace_id: 13655a2f-c350-4830-94c6-9b4c1f84911c (⚠ нет CONSUMER)

- 08:43:40.490 → S4 Прихожая → dimming → di/? → onHold
- 08:43:45.402 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:43:45.403 → SCRIPT → 3.D.TREK.3\4 on

### trace_id: c1c6dc6d-62a5-449d-8434-a96885d27475 (⚠ нет CONSUMER)

- 08:42:44.594 → S4 Прихожая → dimming → di/8 → onHold
- 08:42:45.399 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:42:45.400 → SCRIPT → 3.D.TREK.3\4 on
- 08:42:50.407 → ACTUATOR → D7 / dim/4
- 08:42:51.856 → S4 Прихожая → click → di/3 → onClick
- 08:42:52.977 → S4 Коридор → dimming → di/6 → onHold
- 08:42:53.755 → S4 Прихожая → dimming → di/2 → onHold
- 08:42:55.404 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:43:01.396 → S4 Коридор → dimming → di/3 → onHold
- 08:43:01.762 → S4 Прихожая → dimming → di/2 → onHold
- 08:43:05.406 → SCRIPT → 3.D.TREK.3\4 on
- 08:43:05.408 → SCRIPT → 3.D.TREK.3\4 toggle1

### trace_id: 5f843f83-02b8-4f7e-b332-dd477abd2e7c (⚠ нет CONSUMER)

- 08:42:11.337 → S4 Прихожая → unknown → di/? → unknown
- 08:42:12.056 → S4 Коридор → dimming → di/7 → onHold
- 08:42:12.641 → S4 Прихожая → dimming → di/3 → onHold
- 08:42:14.803 → S4 Прихожая → dimming → di/2 → onHold
- 08:42:15.399 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:42:15.400 → SCRIPT → 3.D.TREK.3\4 on
- 08:42:20.406 → ACTUATOR → D7 / dim/4
- 08:42:25.403 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:42:30.402 → SCRIPT → 3.D.TREK.3\4 on
- 08:42:30.407 → ACTUATOR → D7 / dim/4

### trace_id: 37d5091e-2e77-44bd-aca8-fb838454427d (⚠ нет CONSUMER)

- 08:41:57.874 → S4 Прихожая → dimming → di/3 → onHold
- 08:41:58.051 → S4 Коридор → dimming → di/4 → onHold
- 08:42:00.417 → ACTUATOR → D7 / dim/4
- 08:42:01.335 → S4 Прихожая → click → di/2 → onClick
- 08:42:01.449 → S4 Коридор → dimming → di/4 → onHold
- 08:42:03.716 → S4 Прихожая → click → di/3 → onClick
- 08:42:04.853 → S4 Коридор → click → di/5 → onClick
- 08:42:05.403 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:42:06.217 → S4 Прихожая → dimming → di/2 → onHold
- 08:42:07.087 → S4 Коридор → dimming → di/? → onHold
- 08:42:08.284 → S4 Прихожая → click → di/2 → onClick
- 08:42:10.341 → S4 Прихожая → press → di/2 → onClick
- 08:42:10.402 → SCRIPT → 3.D.TREK.3\4 on
- 08:42:10.408 → ACTUATOR → D7 / dim/4

### trace_id: d62042b4-bbb0-4320-8e1a-4dd0cf3e804c (⚠ нет CONSUMER)

- 08:40:08.105 → S4 Прихожая → dimming → di/2 → onHold
- 08:40:09.644 → S4 Коридор → dimming → di/1 → onHold
- 08:40:10.401 → SCRIPT → 3.D.TREK.3\4 on
- 08:40:10.405 → ACTUATOR → D7 / dim/4
- 08:40:13.430 → S4 Прихожая → dimming → di/4 → onHold
- 08:40:15.400 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:40:17.270 → S4 Прихожая → dimming → di/2 → onHold
- 08:40:20.402 → SCRIPT → 3.D.TREK.3\4 on
- 08:40:20.408 → ACTUATOR → D7 / dim/4
- 08:40:23.179 → S4 Коридор → click → di/2 → onClick
- 08:40:25.404 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:40:30.406 → ACTUATOR → D7 / dim/4
- 08:40:30.565 → S4 Коридор → click → di/2 → onClick
- 08:40:30.667 → S4 Прихожая → dimming → di/2 → onHold
- 08:40:33.993 → S4 Прихожая → dimming → di/2 → onHold
- 08:40:35.401 → SCRIPT → 3.D.TREK.3\4 on
- 08:40:35.405 → ACTUATOR → D7 / dim/4
- 08:40:37.963 → S4 Прихожая → dimming → di/1 → onHold
- 08:40:40.399 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:40:44.416 → S4 Коридор → dimming → di/? → onHold
- 08:40:45.410 → ACTUATOR → D7 / dim/4
- 08:40:50.401 → SCRIPT → 3.D.TREK.3\4 on
- 08:40:50.403 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:40:51.364 → S4 Прихожая → dimming → di/2 → onHold
- 08:40:52.949 → S4 Коридор → click → di/2 → onClick
- 08:40:55.407 → ACTUATOR → D7 / dim/4

### trace_id: d9e9cad9-9b6a-4293-8fe3-d2bb36e4e217 (⚠ нет CONSUMER)

- 08:39:06.390 → S4 Прихожая → dimming → di/2 → onHold
- 08:39:06.800 → S4 Коридор → click → di/4 → onClick
- 08:39:09.734 → S4 Коридор → dimming → di/2 → onHold
- 08:39:10.408 → ACTUATOR → D7 / dim/4
- 08:39:15.399 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:39:15.400 → SCRIPT → 3.D.TREK.3\4 on
- 08:39:16.512 → S4 Коридор → dimming → di/4 → onHold
- 08:39:19.837 → S4 Коридор → dimming → di/6 → onHold
- 08:39:23.271 → S4 Прихожая → dimming → di/2 → onHold
- 08:39:25.400 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:39:25.401 → SCRIPT → 3.D.TREK.3\4 on
- 08:39:26.894 → S4 Коридор → dimming → di/2 → onHold
- 08:39:30.407 → ACTUATOR → D7 / dim/4
- 08:39:34.322 → S4 Коридор → dimming → di/4 → onHold
- 08:39:35.403 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:39:37.680 → S4 Коридор → dimming → di/2 → onHold
- 08:39:40.402 → SCRIPT → 3.D.TREK.3\4 on
- 08:39:40.408 → ACTUATOR → D7 / dim/4
- 08:39:42.514 → S4 Коридор → click → di/3 → onClick
- 08:39:45.404 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:39:45.493 → S4 Коридор → dimming → di/1 → onHold
- 08:39:47.635 → S4 Коридор → dimming → di/2 → onHold
- 08:39:50.407 → ACTUATOR → D7 / dim/4
- 08:39:53.206 → S4 Прихожая → dimming → di/4 → onHold
- 08:39:55.402 → SCRIPT → 3.D.TREK.3\4 on
- 08:39:55.407 → ACTUATOR → D7 / dim/4
- 08:39:57.567 → S4 Коридор → click → di/3 → onClick
- 08:40:00.409 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:40:01.698 → S4 Коридор → click → di/2 → onClick
- 08:40:03.332 → S4 Прихожая → click → di/3 → onClick
- 08:40:05.407 → ACTUATOR → D7 / dim/4

### trace_id: 4cb7982e-4708-4399-bd87-9896b8ee1373 (⚠ нет CONSUMER)

- 08:38:58.190 → S4 Прихожая → dimming → di/2 → onHold
- 08:39:00.409 → SCRIPT → 3.D.TREK.3\4 toggle1
- 08:39:00.410 → SCRIPT → 3.D.TREK.3\4 on

## Site: Спальная

### trace_id: 602257b8-de5b-4aab-b30b-3a22eba5e963

- 08:50:54.742 → S4 Спальная → click → di/2 → onClick
- 08:50:56.287 → S4 Спальная → click → di/2 → onClick
- 08:50:59.478 → SCRIPT → 🌑/7.D.TREK\7.D.L.4 toggle
- 08:50:59.479 → SCRIPT → light on спальная
- 08:50:59.479 → SCRIPT → 7.D.TREK.7 off
- 08:50:59.480 → CONSUMER → Освещение/7.D.L.4
- 08:50:59.480 → CONSUMER → Трек/7.D.TREK.7
- 08:50:59.486 → ACTUATOR → Dim1 / dim/4
- 08:50:59.486 → SCRIPT → 🌑/7.D.TREK\7.D.L.4 toggle
- 08:50:59.487 → ACTUATOR → D7 / dim/7

### trace_id: 9c1f4634-a865-40ac-a09d-9242db468c7b

- 08:43:20.313 → S4 Спальная → click → di/2 → onClick
- 08:43:21.676 → SCRIPT → 7.D.LED.17 Toggle
- 08:43:21.677 → SCRIPT → 7.D.LED.17 off
- 08:43:21.678 → CONSUMER → Подсветка кровати/7.D.LED.17
- 08:43:21.682 → ACTUATOR → Dim5 / dim/5
- 08:43:21.966 → S4 Спальная → click → di/2 → onClick

### trace_id: ae17f8ec-21ec-4541-bbaa-eefb2005be87

- 08:40:48.548 → S4 Спальная → dimming → di/2 → onHold
- 08:40:49.544 → SCRIPT → 7.D.LED.17 Toggle
- 08:40:49.545 → SCRIPT → 7.D.LED.17 on
- 08:40:49.546 → CONSUMER → Подсветка кровати/7.D.LED.17
- 08:40:49.548 → ACTUATOR → Dim5 / dim/5
- 08:41:07.681 → S4 Спальная → click → di/3 → onClick
- 08:41:10.005 → S4 Спальная → click → di/2 → onClick

### trace_id: 1fb2b9cd-0f89-4a8c-97ff-b6d57fd981ee

- 08:40:03.314 → S4 Спальная → click → di/2 → onClick
- 08:40:05.303 → S4 Спальная → dimming → di/1 → onHold
- 08:40:06.360 → SCRIPT → 7.D.LED.17 Toggle
- 08:40:06.361 → SCRIPT → 7.D.LED.17 off
- 08:40:06.362 → CONSUMER → Подсветка кровати/7.D.LED.17
- 08:40:06.366 → ACTUATOR → Dim5 / dim/5
- 08:40:08.276 → S4 Спальная → click → di/2 → onClick

## Site: Старшая

### trace_id: dea240ef-72a4-470e-963f-552723f0c926

- 08:46:25.376 → S4 Старшая → click → di/2 → onClick
- 08:46:29.858 → SCRIPT → 5.D.LED Toggle
- 08:46:29.859 → SCRIPT → 5.D.LED off
- 08:46:29.860 → CONSUMER → Подсветка полок Ромы/5.D.LED.11
- 08:46:29.862 → CONSUMER → Подсветка полок Макса/5.D.LED.15
- 08:46:29.863 → CONSUMER → Подсветка полок над столом Ромы/5.D.LED.12
- 08:46:29.864 → CONSUMER → Подсветка стола Макса/5.D.LED.16
- 08:46:29.865 → CONSUMER → Подсветка стола Ромы/5.D.LED.13
- 08:46:29.872 → ACTUATOR → Dim5 / dim/3
- 08:46:29.874 → ACTUATOR → Dim5 / dim/4
- 08:46:29.875 → ACTUATOR → Dim5 / dim/1
- 08:46:29.876 → ACTUATOR → Dim4 / dim/4
- 08:46:29.878 → ACTUATOR → Dim4 / dim/8

### trace_id: 1539508c-9778-4a79-80fb-b0d755754e85

- 08:45:26.879 → S4 Старшая → dimming → di/? → onHold
- 08:45:27.871 → SCRIPT → 5.D.LED Toggle
- 08:45:27.872 → SCRIPT → 5.D.LED on
- 08:45:27.873 → CONSUMER → Подсветка полок Ромы/5.D.LED.11
- 08:45:27.874 → CONSUMER → Подсветка полок над столом Ромы/5.D.LED.12
- 08:45:27.874 → CONSUMER → Подсветка полок Макса/5.D.LED.15
- 08:45:27.875 → CONSUMER → Подсветка стола Макса/5.D.LED.16
- 08:45:27.875 → CONSUMER → Подсветка стола Ромы/5.D.LED.13
- 08:45:27.877 → ACTUATOR → Dim5 / dim/3
- 08:45:27.878 → ACTUATOR → Dim5 / dim/4
- 08:45:27.879 → ACTUATOR → Dim5 / dim/1
- 08:45:27.879 → ACTUATOR → Dim4 / dim/4
- 08:45:27.880 → ACTUATOR → Dim4 / dim/8
- 08:45:30.882 → S4 Старшая → click → di/4 → onClick
- 08:45:31.935 → S4 Старшая → click → di/5 → onClick

### trace_id: 7f1ee2fb-c504-42f3-bbe5-73feb8bba35c

- 08:44:56.239 → S4 Старшая → click → di/2 → onClick
- 08:45:10.464 → SCRIPT → 5.D.LED Toggle
- 08:45:10.465 → SCRIPT → 5.D.LED off
- 08:45:10.466 → CONSUMER → Подсветка полок Ромы/5.D.LED.11
- 08:45:10.467 → CONSUMER → Подсветка полок Макса/5.D.LED.15
- 08:45:10.467 → CONSUMER → Подсветка полок над столом Ромы/5.D.LED.12
- 08:45:10.468 → CONSUMER → Подсветка стола Макса/5.D.LED.16
- 08:45:10.468 → CONSUMER → Подсветка стола Ромы/5.D.LED.13
- 08:45:10.470 → ACTUATOR → Dim5 / dim/3
- 08:45:10.472 → ACTUATOR → Dim4 / dim/4
- 08:45:10.473 → ACTUATOR → Dim4 / dim/8
- 08:45:10.473 → ACTUATOR → Dim5 / dim/4
- 08:45:10.474 → ACTUATOR → Dim5 / dim/1

### trace_id: 745aedc7-63f7-4f0a-8a48-54a6a287ca4e

- 08:44:05.501 → S4 Старшая → dimming → di/4 → onHold
- 08:44:08.478 → SCRIPT → 5.D.LED Toggle
- 08:44:08.479 → SCRIPT → 5.D.LED on
- 08:44:08.480 → CONSUMER → Подсветка полок Ромы/5.D.LED.11
- 08:44:08.481 → CONSUMER → Подсветка полок над столом Ромы/5.D.LED.12
- 08:44:08.481 → CONSUMER → Подсветка полок Макса/5.D.LED.15
- 08:44:08.482 → CONSUMER → Подсветка стола Макса/5.D.LED.16
- 08:44:08.482 → CONSUMER → Подсветка стола Ромы/5.D.LED.13
- 08:44:08.485 → ACTUATOR → Dim4 / dim/4
- 08:44:08.486 → ACTUATOR → Dim4 / dim/8
- 08:44:08.486 → ACTUATOR → Dim5 / dim/3
- 08:44:08.487 → ACTUATOR → Dim5 / dim/4
- 08:44:08.487 → ACTUATOR → Dim5 / dim/1

### trace_id: b0f83534-a5b8-4bdd-85b3-f8b1c8f98de7

- 08:43:59.673 → S4 Старшая → hold → di/1 → onHold
- 08:44:01.883 → SCRIPT → 5.D.LED Toggle
- 08:44:01.884 → SCRIPT → 5.D.LED off
- 08:44:01.885 → CONSUMER → Подсветка полок Ромы/5.D.LED.11
- 08:44:01.885 → CONSUMER → Подсветка полок Макса/5.D.LED.15
- 08:44:01.886 → CONSUMER → Подсветка полок над столом Ромы/5.D.LED.12
- 08:44:01.886 → CONSUMER → Подсветка стола Макса/5.D.LED.16
- 08:44:01.886 → CONSUMER → Подсветка стола Ромы/5.D.LED.13
- 08:44:01.889 → ACTUATOR → Dim5 / dim/3
- 08:44:01.890 → ACTUATOR → Dim5 / dim/4
- 08:44:01.891 → ACTUATOR → Dim5 / dim/1
- 08:44:01.891 → ACTUATOR → Dim4 / dim/4
- 08:44:01.892 → ACTUATOR → Dim4 / dim/8

### trace_id: 7c4dbb18-4f38-4295-95ee-926284f62dcf

- 08:42:43.263 → S4 Старшая → dimming → di/8 → onHold
- 08:42:45.247 → SCRIPT → 5.D.LED Toggle
- 08:42:45.248 → SCRIPT → 5.D.LED on
- 08:42:45.249 → CONSUMER → Подсветка полок Ромы/5.D.LED.11
- 08:42:45.250 → CONSUMER → Подсветка полок над столом Ромы/5.D.LED.12
- 08:42:45.251 → CONSUMER → Подсветка полок Макса/5.D.LED.15
- 08:42:45.251 → CONSUMER → Подсветка стола Макса/5.D.LED.16
- 08:42:45.251 → CONSUMER → Подсветка стола Ромы/5.D.LED.13
- 08:42:45.254 → ACTUATOR → Dim4 / dim/4
- 08:42:45.255 → ACTUATOR → Dim4 / dim/8
- 08:42:45.256 → ACTUATOR → Dim5 / dim/3
- 08:42:45.256 → ACTUATOR → Dim5 / dim/4
- 08:42:45.257 → ACTUATOR → Dim5 / dim/1

## Site: M1

### trace_id: 82e7eefc-b522-4eca-995c-ff8bf56b09bf (⚠ нет CONSUMER)

- 08:47:33.926 → M1 → press → di/14 → onClick
- 08:47:33.935 → SCRIPT → Геркон дверь открыта
- 08:47:33.936 → SCRIPT → Геркон дверь закрыта
- 08:47:33.949 → SCRIPT → 🔐/Открыть замок
- 08:47:33.950 → ACTUATOR → R5 / do/7
- 08:47:34.927 → M1 → hold → di/14 → onHold

---

## Список trace_id без CONSUMER в этой выборке

- Душ: 1b083014-5820-4388-a316-1f7ae8089f17
- Коридор: 438b4b6e-a305-4e70-b631-e2851ea58a0e
- Коридор: 1e6a41fe-1e97-4157-a3e0-a6093b2cba62
- Коридор: ff1bb210-e87c-424f-8417-d5572e60d388
- Коридор: fa9470b0-8cc9-4931-b5ba-3fd003c1eba5
- Коридор: f661ea29-7df1-4bca-8fe4-e248dc8ffbf3
- Коридор: 0e03fb22-16d8-4ac8-a657-8fafee338483
- Коридор: 1bb01922-dc04-47e6-8919-4826ef1646ca
- Коридор: e8179019-745c-4eff-b644-961337b7a659
- Коридор: 26a8cc41-01f7-4e22-b141-b89ecf637269
- Коридор: 234bf72f-c462-4d41-902b-64300082279a
- Лоджия: 6646b745-7b63-4276-b2e7-c194eeaec893
- Прихожая: 830b5f71-b42f-4a15-845d-cb3951b7ae99
- Прихожая: 12d9d636-8fd3-4fe9-993a-4bdacd87b03c
- Прихожая: 3070665d-ad88-4f20-a0d9-4ccf7bd1ce38
- Прихожая: 070af9ad-7ca1-455f-ab8f-488ff789eed9
- Прихожая: 5aafd197-3d10-46b0-8f00-804b78970cd8
- Прихожая: 8cdb9cc1-71c8-4d73-93c4-640d2ca685b0
- Прихожая: 5a91ef43-f2f6-4706-b462-84d2740c0718
- Прихожая: 2ace6b06-1f91-49b6-b05e-59af187d4b75
- Прихожая: 13655a2f-c350-4830-94c6-9b4c1f84911c
- Прихожая: c1c6dc6d-62a5-449d-8434-a96885d27475
- Прихожая: 5f843f83-02b8-4f7e-b332-dd477abd2e7c
- Прихожая: 37d5091e-2e77-44bd-aca8-fb838454427d
- Прихожая: d62042b4-bbb0-4320-8e1a-4dd0cf3e804c
- Прихожая: d9e9cad9-9b6a-4293-8fe3-d2bb36e4e217
- Прихожая: 4cb7982e-4708-4399-bd87-9896b8ee1373
- M1: 82e7eefc-b522-4eca-995c-ff8bf56b09bf
