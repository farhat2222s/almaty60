#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "AL60GameMode.generated.h"

UCLASS()
class AL60_API AAL60GameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    AAL60GameMode();
protected:
    virtual void BeginPlay() override;
};
