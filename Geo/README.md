# Географический Арбат · ALMATY 60

Реальный участок Алматы площадью около 1015 × 500 м подготовлен из OpenStreetMap: контуры зданий, оси дорог и дорожек, площади, зелёные зоны и POI. Это отдельный географический набор для новой сцены. Координаты и сохранения исходного игрового прототипа не переопределены.

| Слой | Объектов |
|---|---:|
| Дороги и дорожки | 530 |
| Здания | 165 |
| POI | 461 |
| Площади | 4 |
| Зелёные зоны | 108 |
| Всего | 1268 |

В наборе 4717 вершин. POI и названия организаций взяты из OSM; их наличие на карте не означает участие в акциях ALMATY 60.

## Источник и происхождение

Оригинал сохранён в `source/arbat-osm.xml`, нормализованные данные — в `exports/arbat.geojson`. Запрос: [OSM API, участок Арбата](https://www.openstreetmap.org/api/0.6/map?bbox=76.9375,43.2585,76.9500,43.2630). Границы WGS84 в порядке west/south/east/north: `[76.9375,43.2585,76.95,43.263]`.

Время получения `2026-09-09T11:31:35.183290Z` восстановлено по времени изменения завершённого скачанного файла. Это не HTTP Date и не время последней правки OSM. Основание явно записано как `source.retrievedAtBasis`. SHA-256 исходного файла: `9b4b0655c938a93f09903dcb517ba712a40c6456d652532b61938540024732b9`.

Начало координат — [OSM node 12181379270](https://www.openstreetmap.org/node/12181379270), longitude **76.9432304**, latitude **43.2618928**. В сохранённом XML узел входит в [пешеходную улицу 387242322](https://www.openstreetmap.org/way/387242322) с `loc_name=Арбат` и названием Жібек Жолы даңғылы. Версия узла 1, время его правки `2024-09-17T05:01:22Z`. Полная запись — `origin.json`.

Данные OSM распространяются с указанием авторства и лицензии ODbL. Атрибуция для карты и 3D-сцены: **© OpenStreetMap contributors · ODbL**, со ссылкой на [страницу авторских прав OSM](https://www.openstreetmap.org/copyright). Производные геоданные этого набора предоставлены под [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); сохранены исходник, метаданные и преобразованные данные. См. `LICENSE-OSM.md`.

## Координаты и контракт

`../Playable/public/geo/georef.mjs` переводит WGS84 → ECEF → локальные ENU-координаты и обратно. Нулевой `alt` — опорный эллипсоид, без высотной съёмки. Для плоской визуализации можно ставить высоту поверхности равной 0; небольшая отрицательная компонента up в точном экспорте отражает кривизну эллипсоида.

| Представление | Порядок и единицы |
|---|---|
| GeoJSON | `[longitude, latitude]`, градусы WGS84 |
| Объект локальной позиции | `{x: east, z: south, y: up}`, метры |
| Массив в `district-local.json` | `[xEast, zSouth, yUp]`, метры |
| Unreal | `{X:x*100, Y:z*100, Z:y*100}`, сантиметры |

Юг соответствует положительному `z`, север — отрицательному. В географическом JSON нет координат UE или старого прототипа. В локальном JSON намеренно указан собственный тип `AL60LocalFeatureCollection`, а не WGS84 GeoJSON.

```js
import {createGeoReference} from './geo/georef.mjs';
const config = await fetch('/geo/origin.json').then(r => r.json());
const ref = createGeoReference(config.wgs84);
const local = ref.toLocal({lon:76.944, lat:43.262, alt:0});
const geographic = ref.fromLocal(local);
const centimeters = ref.toUE(geographic);
```

`district-local.json` содержит `version`, `coordinateSystem`, `bounds`, `source`, `counts`, `features`. Геометрии: `Point`, `LineString`, `MultiLineString`, `Polygon`; вложенность аналогична GeoJSON. Свойства каждого объекта: `kind`, `osmType`, `osmId`, `name`, `tags`, `source`, `sourceUrl`, `geometryClipped`. Для зданий добавлены `heightMeters`, `heightSource`, `heightEstimated` и пояснение допущения, когда оно применено. `sourceUrl` — адрес исходного запроса; страницу конкретного объекта можно составить по `osmType` и `osmId`.

## Локальная карта и 2ГИС

Геометрия собственной сцены поступает из OSM. Интерактивная 2ГИС подключается отдельно через официальный MapGL JS SDK. Адаптер не извлекает коммерческие тайлы или объекты в экспорт UE.

`../Playable/public/geo/map-adapters.mjs` экспортирует `createMapAdapter(provider,container,options)`. Значение по умолчанию выбирает вызывающий интерфейс; для готового режима без ключа используется `osm-local`, для коммерческой карты — `2gis`. В модуле также сохранён необязательный Google-адаптер, который автоматически не запускается.

```js
import {createMapAdapter} from './geo/map-adapters.mjs';
const [collection, config] = await Promise.all([
  fetch('/geo/arbat.geojson').then(r => r.json()),
  fetch('/geo/origin.json').then(r => r.json())
]);
const map = await createMapAdapter('osm-local', container, {
  collection, origin:config.wgs84
});
map.setPlayerWGS84({lon:76.9432304, lat:43.2618928});
// При закрытии панели: map.destroy().
```

Для 2ГИС используется тот же `setPlayerWGS84` и `destroy`:

```js
const map = await createMapAdapter('2gis', container, {
  apiKey: userSuppliedPublicBrowserKey,
  origin: config.wgs84,
  bbox: config.bbox,
  onStatus: ({state}) => updateProviderStatus(state)
});
```

Подключённый интерфейс читает ключ из `Playable/public/geo/provider-config.json`; адрес при запуске — `/geo/provider-config.json`. Формат файла в поставке и ZIP:

```json
{"twoGis":{"apiKey":""}}
```

Владелец настраивает свой публичный браузерный ключ в этом файле локально; передавать его в чат не требуется. Интерфейс не сохраняет ключ в localStorage, модуль адаптера не записывает его и не выводит в журнал. Пустое значение означает **2ГИС не подключён**. Для распространяемого архива оставляется пустая строка.

Нужен доступ к Map Tiles API в [кабинете 2ГИС](https://platform.2gis.ru/), как указано в [официальной инструкции MapGL](https://docs.2gis.com/en/mapgl/start/first-steps). Браузерный ключ доступен клиенту: ограничьте его разрешёнными Referer/Origin и нужным сервисом в [настройках ключа](https://docs.2gis.com/en/platform-manager/subscription/managing-keys). Для местной проверки используются страницы `http://127.0.0.1:3060` и `http://127.0.0.1:3061`; настройте правила доступа для этих development origins с учётом формата поля кабинета. Для опубликованной страницы настройте отдельный ключ с её HTTPS-origin. Подписка и ограничения проверяются 2ГИС, а не длиной строки в интерфейсе.

Без ключа возвращается `state:'needs-key'` и показывается карточка подключения. SDK и тайлы не запрашиваются. При ключе SDK загружается с `https://mapgl.2gis.com/api/js/v1`; состояние проходит через `loading`, затем `ready` после события загрузки стиля, либо `error`/`unverified`. Живое подключение с ключом владельца в этой среде не проверено. Методы карты сверены с [официальным справочником](https://docs.2gis.com/en/mapgl/reference/class).

Основной интерфейс подключает отдельный полноэкранный географический просмотр через `Playable/public/geography.mjs` и `geo-world.mjs`: собственная 3D-сцена, синхронная OSM-схема и переключатель 2ГИС. Синхронизация метки принимает уже известную географическую позицию новой сцены. Она не читает GPS, не подтверждает физическое присутствие и не выдаёт игровые награды. Перенос старых игровых миссий требует отдельной миграции маршрутов и серверной геометрии.

## Экспорт и импорт Unreal

`exports/ue-datatable.json` содержит те же 1268 объектов и вершины в сантиметрах. Для импорта в DataTable скопируйте `ue-import/AL60GeoDataRow.h` в свой игровой C++-модуль, выполните сборку, затем импортируйте JSON с типом строки `AL60GeoDataRow`. `exports/ue-vertices.csv` — плоская таблица вершин с FeatureId, Part и Vertex; у Point одна вершина, у Polygon каждая часть — отдельное кольцо.

`ue-import/import_district.py` создаёт отдельные DynamicMeshActor по настоящим контурам: экструзия зданий, плоские площади и зелёные зоны, полосы вдоль дорожных осей. Это заготовка редактора UE 5.6. Для запуска нужны Python Editor Script Plugin, Editor Scripting Utilities и Geometry Script.

В Python-консоли Unreal, заменив путь на свой:

```python
exec(open('/absolute/path/Geo/ue-import/import_district.py').read())
actors = import_district('/absolute/path/Geo/exports/district-local.json')
```

Импорт создаёт новые акторы в папке `AL60_OSM_<UTC>`, не удаляет объекты и не сохраняет уровень. Геометрия земли плоская, POI остаются в DataTable. Оси дорог превращаются в полосы: width из OSM, при отсутствии — условные 10 м для pedestrian, 2.2 м для footway/path/steps, 7 м для прочих дорог. Это ширина визуализации. Контуры с отверстиями пропускаются с сообщением. Сборка C++, исполнение импортёра и качество коллизии в Unreal здесь не проверены; API сверены с [документацией Epic Geometry Script 5.6](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/GeometryScript_Primitives?application_version=5.6).

Динамические меши — этап подготовки уровня. Материалы, фасады, рельеф, упрощение мешей, объединение объектов и мобильные LOD требуют отдельной работы в UE; готовый мобильный билд этим экспортом не заявляется.

## Воспроизводимость

Нужны Python 3 и Node.js 24, без дополнительных библиотек. Из папки `ALMATY60`:

```sh
python3 Geo/tools/import_osm.py \
  --input Geo/source/arbat-osm.xml \
  --output Geo/exports/arbat.geojson \
  --metadata Geo/exports/source-metadata.json \
  --bbox 76.9375,43.2585,76.9500,43.2630 \
  --source-url 'https://www.openstreetmap.org/api/0.6/map?bbox=76.9375,43.2585,76.9500,43.2630' \
  --retrieved-at '2026-09-09T11:31:35.183290Z' \
  --retrieved-at-basis 'Filesystem modification time of completed root-agent OSM download; not source feature edit time.'
node Geo/tools/export_district.mjs
node --test Geo/tests/*.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s Geo/tests -p 'test_*.py' -v
```

Экспортёр сверяет контрольную сумму сохранённого XML, проверяет границы и копирует нужные файлы в `Playable/public/geo/`. Новое скачивание требует нового времени получения; не переносите указанный timestamp на другой источник. Для другого района также изменяются начало координат и границы, а не только входной файл.

Импортёр ограничивает размер XML 20 MiB, число узлов одной линии 2000, запрещает DTD/entities, отсекает невалидные координаты и обрезает геометрию по границам. Экспортёр ограничивает 20000 объектов и 200000 вершин.

## Пределы данных

Из исходных 130 relations не импортирована ни одна; среди них один multipolygon. Поддерживаются полные линии дорог, простые замкнутые контуры и POI-узлы с классифицирующими тегами. Неполные, самопересекающиеся и неподдерживаемые контуры не дорисовываются. Подробные причины и счётчики находятся в `exports/source-metadata.json`.

Высоты 7 зданий получены из тега height; это сведения OSM, а не собственное измерение. Для 102 зданий применена оценка building:levels × 3 м, для 56 — условные 9 м. Эти различия сохранены в JSON и UE-экспорте. Качество и актуальность городской карты зависят от исходных данных.

Итоги выполненных проверок — `VERIFIED.md`.
