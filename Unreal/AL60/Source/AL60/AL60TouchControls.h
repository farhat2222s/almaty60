#pragma once
#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "AL60TouchControls.generated.h"
class UTextBlock;
class UButton;
UCLASS()
class AL60_API UAL60TouchControls : public UUserWidget
{
    GENERATED_BODY()
protected:
    virtual void NativeOnInitialized() override;
    virtual void NativeTick(const FGeometry& Geometry,float DeltaSeconds) override;
private:
    UPROPERTY() UTextBlock* JumpText;
    UPROPERTY() UTextBlock* ActionText;
    UPROPERTY() UTextBlock* SprintText;
    UPROPERTY() UButton* LoginControl;
    UFUNCTION() void JumpPressed();
    UFUNCTION() void JumpReleased();
    UFUNCTION() void InteractPressed();
    UFUNCTION() void SprintPressed();
    UFUNCTION() void SprintReleased();
    UFUNCTION() void LoginPressed();
};
