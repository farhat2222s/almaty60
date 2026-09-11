#pragma once
#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "AL60PlayerController.generated.h"
class UAL60TouchControls;
class UAL60LoginWidget;
UCLASS()
class AL60_API AAL60PlayerController : public APlayerController
{
    GENERATED_BODY()
public:
    void ToggleLogin();
    void CloseLogin();
protected:
    virtual void BeginPlay() override;
private:
    UPROPERTY() UAL60TouchControls* TouchControls;
    UPROPERTY() UAL60LoginWidget* LoginWidget;
};
