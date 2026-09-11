# AL60 Unreal — готовность к компиляции

Дата ревью: 9 сентября 2026. Статус: **исходники подготовлены к первой сборке, компиляция не выполнялась.** На этой машине нет Unreal Engine, полного Xcode и Android SDK, поэтому ни одна строка ниже не является отчётом об успешной сборке. Это результат построчного ревью 14 `.cpp` и 14 `.h` файлов, конфигов и скриптов против API Unreal Engine 5.x, плюс автоматические статические проверки.

UE 5.8 вышел 17 июня 2026 года, значит `EngineAssociation: 5.8` в `AL60.uproject` корректен. Bootstrap и упаковка рассчитаны на эту версию.

## Что исправлено в этом ревью

| Файл | Проблема | Исправление |
|---|---|---|
| `AL60MissionManager.h` | `UFUNCTION(BlueprintPure) const FAL60MissionState& GetState()` — UnrealHeaderTool не принимает ссылочный возврат из UFUNCTION | Возврат по значению `FAL60MissionState GetState() const` |
| `AL60MissionManager.h/.cpp` | Неиспользуемый параметр `UnusedPlayerId = TEXT("")` в UFUNCTION: лишний риск для парсера UHT | Параметр удалён, все вызовы приведены |
| `AL60CityWorld.cpp` | `FMath::Max(0, FMath::CeilToInt(double))` — в UE5 `CeilToInt(double)` возвращает `int64`, а `FMath::Max` не выводит тип из `int` и `int64` | `FMath::CeilToInt32(...)` |
| `AL60CityWorld.cpp` | В `Tick` состояние миссии копировалось трижды на каждые ворота | Одна копия на тик |
| 5 файлов с `FObjectFinder<UStaticMesh>` / `LoadObject<UStaticMesh>` | Полный тип `UStaticMesh` мог не быть виден через `StaticMeshComponent.h` при строгом IWYU | Явный `#include "Engine/StaticMesh.h"` |
| `AL60TouchControls.cpp` | `UButton::SetIsFocusable` есть не во всех версиях UMG | Вызов убран; кнопки остаются кликабельными |
| 6 файлов с кириллицей в `TEXT("...")` | Без BOM MSVC на Windows читает файл в системной кодировке и портит строки | Добавлен UTF-8 BOM |
| `Scripts/bootstrap-native.sh` | Путь `.uproject` передавался позиционно | Явный `-project=` для UnrealBuildTool |
| `Scripts/bootstrap_arbat.py` | Переопределение GameMode уровня падало бы при отсутствии метода в Python API | Обёрнуто в try/except; `GlobalDefaultGameMode` из `DefaultEngine.ini` всё равно действует |
| `Scripts/check-native-static.sh` | Не было повторяемой проверки | Новый скрипт, см. ниже |

## Что проверено и признано корректным

- Порядок include: `*.generated.h` последний во всех 14 заголовках.
- Все обработчики `AddDynamic` объявлены как `UFUNCTION`.
- `FTSTicker` и `FDelegateHandle`, `BindWeakLambda` для HTTP, `TJsonReader/Writer`, `TryGet*Field`, `SCENE_QUERY_STAT`, `SpawnActorDeferred`, `UMaterialInstanceDynamic::Create`, `AHUD::DrawText/DrawRect/GetTextSize`, `UWidgetTree::ConstructWidget`, `UEditableTextBox::GetWidgetStyle/SetWidgetStyle`, `UTextBlock::GetFont/SetFont` соответствуют UE 5.1+.
- `FCollisionQueryParams(SCENE_QUERY_STAT(...), false, this)` — макрос раскрывается в два аргумента, конструктор с `TStatId` существует.
- `BindAction(..., this, &ACharacter::Jump)` из подкласса — стандартный шаблонный паттерн UE, компилируется.
- Контракт с `StagingBackend`: все поля JSON, которые читает `AL60MissionManager.cpp`, и все маршруты `/api/...` существуют в `StagingBackend/src/service.mjs`.
- Конфиги: `DefaultInput.ini` явно оставляет legacy `PlayerInput` и `InputComponent`, поэтому `BindAxis/BindAction` по именам работают при включённом плагине EnhancedInput.
- Точка спавна `(-6150, -350, 120)` не пересекается с процедурной геометрией города.

## Статические проверки

```bash
bash Unreal/AL60/Scripts/check-native-static.sh
```

Проверяет: JSON проекта, порядок `generated.h`, ссылочные возвраты и `TEXT()` в UFUNCTION, UTF-8 BOM, баланс скобок, UFUNCTION у обработчиков делегатов, `*ToInt` на double, синтаксис ini, Python и bash, соответствие полей и маршрутов backend. Результат на момент ревью: пройдено, 14 cpp, 14 headers.

## Порядок первой сборки на машине с UE 5.8

1. Установить UE 5.8 через Epic Games Launcher и полный Xcode, совместимый с 5.8. Проверить `xcodebuild -version`; Command Line Tools недостаточно.
2. Из папки `ALMATY60`:

```bash
export AL60_UE_ROOT='/Users/Shared/Epic Games/UE_5.8'
bash Unreal/AL60/Scripts/bootstrap-native.sh
```

3. Скрипт собирает `AL60Editor Mac Development`, затем запускает редактор с `bootstrap_arbat.py`, который создаёт два материала и карту `/Game/Maps/AL60Prototype` с PlayerStart. Город, NPC, машины и ворота создаются кодом при нажатии Play.
4. Открыть `AL60.uproject`, нажать Play, пройти чек-лист из `device-validation.md`.
5. Для телефона: запустить `StagingBackend` на доступном HTTPS-адресе и передать его через `-AL60Backend=https://...` или `BackendBaseUrl` в `DefaultGame.ini`. `127.0.0.1` на телефоне указывает на сам телефон.
6. Упаковка: `bash Unreal/AL60/Scripts/package-native.sh Mac|Android|IOS`.

## Что может сломаться при первой компиляции и как чинить

Ревью снимает ошибки, видимые в тексте, но не заменяет компилятор. Наиболее вероятные остаточные проблемы по убыванию вероятности:

1. **Legacy input в 5.8.** Если UE 5.8 удалил или отключил `BindAxis/BindAction` по именам из `DefaultInput.ini`, персонаж не будет реагировать на ввод. Признак: сборка проходит, управление мертво. Решение: перенести шесть осей и пять действий на EnhancedInput (Input Mapping Context + Input Actions), плагин уже включён в `.uproject`.
2. **Доступ к свойствам UMG.** Если компилятор сообщит `deprecated` или `private` для `GetFont`, `GetWidgetStyle`, `SetBackgroundColor`, заменить на актуальные аксессоры той же версии; это точечные однострочные правки в `AL60TouchControls.cpp` и `AL60LoginWidget.cpp`.
3. **Предупреждения UBT** про `BuildSettingsVersion.V5` при наличии V6: только предупреждение, сборка продолжается. При желании поднять версию в обоих `Target.cs`.
4. **Сырые указатели в UPROPERTY** дают предупреждения о `TObjectPtr`; на сборку не влияют.
5. **Материалы.** Если bootstrap не создал `M_AL60_Palette`, код падает на `BasicShapeMaterial` с параметром `Color`, город станет серым, но запустится.

После устранения ошибок компилятора повторить `check-native-static.sh` и записать фактический результат в `environment-and-static-checks.json`: поле `unreal_compilation` должно перестать быть `not run`.

## Что по-прежнему не сделано

- Компиляция, запуск в редакторе, cook, APK и IPA.
- Замеры FPS на устройствах.
- Финальные модели и анимации вместо примитивов.
- Серверная проверка езды на автомобиле и свободных городских заданий.

## Графика v2 (11 сентября 2026) — по-прежнему без компиляции

На машине автора Unreal Engine установить нельзя (8 ГБ ОЗУ, 18 ГБ свободного места), поэтому изменения ниже прошли только статическую проверку `check-native-static.sh`. Каждая функция имеет откат к прежнему виду, если ассеты не импортированы или флаг выключен.

| Что | Где | Откат |
|---|---|---|
| Sky Atmosphere + Exponential Height Fog + Post Process (bloom 0.35, AO 0.6, гистограммная экспозиция, виньетка, насыщенность) | `AL60CityWorld::BuildLighting`, компоненты на акторе города | `bUseSkyAtmosphere=false` возвращает unlit-сферу неба и прежний свет |
| Солнце как `bAtmosphereSunLight`, SkyLight с real-time capture | там же | на мобильных capture заменяется кубомапой автоматически |
| Скелетный герой: первый `USkeletalMesh` из `/Game/Characters`, клипы Idle/Walk/Run по имени через AssetRegistry, масштаб до 176 см, `AnimationSingleNode` | `AL60HumanoidCharacter::TryLoadSkeletalHero`, переключение клипов в `Tick` | без ассетов остаётся процедурный манекен; NPC (`AL60Citizen`) всегда манекены |
| Импорт `casual-character.glb` (Quaternius CC0) и PNG-текстур из `Playable/public/assets` через `AssetImportTask` (Interchange) | `Scripts/bootstrap_arbat.py::import_visual_assets` | ошибки импорта логируются, bootstrap продолжается |
| Материал плитки Арбата `M_AL60_Paving` с world-aligned UV из `arbat-paving-albedo-v3.png` | bootstrap + `AL60CityWorld::Shape` для групп Promenade/Sidewalk | без текстуры используется палитра |
| Bloom/AO/автоэкспозиция включены в `DefaultEngine.ini`, `sg.PostProcessQuality` 1 на базовых профилях и 2 на 60-FPS профилях, `r.Mobile.AmbientOcclusion=1` | Config | профили можно вернуть на 0 |

Новая зависимость модуля: `AssetRegistry` в `AL60.Build.cs`.

Что проверить первым на машине с UE: (1) компиляцию `AL60HumanoidCharacter.cpp` — `FAssetData::AssetClassPath` и `USkeletalMeshComponent::SetSkeletalMeshAsset` требуют UE 5.1+; (2) ориентацию импортированного героя, параметр `HeroMeshYaw` (по умолчанию −90°); (3) имена клипов после импорта Interchange, поиск идёт по подстрокам Idle/Walk/Run; (4) производительность AO на телефоне, при просадке вернуть `sg.PostProcessQuality=0`.
