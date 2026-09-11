#include "AL60GameMode.h"
#include "AL60PlayerCharacter.h"
#include "AL60HUD.h"
#include "AL60CityWorld.h"
#include "AL60PlayerController.h"
#include "Engine/World.h"
#include "EngineUtils.h"

AAL60GameMode::AAL60GameMode()
{
    DefaultPawnClass = AAL60PlayerCharacter::StaticClass();
    HUDClass = AAL60HUD::StaticClass();
    PlayerControllerClass = AAL60PlayerController::StaticClass();
}

void AAL60GameMode::BeginPlay()
{
    Super::BeginPlay();
    for (TActorIterator<AAL60CityWorld> It(GetWorld()); It; ++It) return;
    GetWorld()->SpawnActor<AAL60CityWorld>();
}
