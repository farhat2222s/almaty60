#pragma once
#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "AL60CitySaveGame.generated.h"

// Local single-player progression only. This file never authorizes a brand reward.
UCLASS()
class AL60_API UAL60CitySaveGame : public USaveGame
{
    GENERATED_BODY()
public:
    UPROPERTY(SaveGame) int32 Xp = 0;
    UPROPERTY(SaveGame) int32 Coins = 0;
    UPROPERTY(SaveGame) TArray<FName> Discovered;
    UPROPERTY(SaveGame) TArray<FName> CompletedQuests;
};
