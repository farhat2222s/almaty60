#pragma once
#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "AL60LoginWidget.generated.h"
class UEditableTextBox;
class UTextBlock;
UCLASS()
class AL60_API UAL60LoginWidget : public UUserWidget
{
    GENERATED_BODY()
protected:
    virtual void NativeOnInitialized() override;
    virtual void NativeTick(const FGeometry& Geometry,float DeltaSeconds) override;
private:
    UPROPERTY() UEditableTextBox* Email;
    UPROPERTY() UEditableTextBox* Password;
    UPROPERTY() UEditableTextBox* DisplayName;
    UPROPERTY() UTextBlock* Status;
    UFUNCTION() void SignIn();
    UFUNCTION() void Register();
    UFUNCTION() void Close();
    void Submit(bool bRegister);
};
