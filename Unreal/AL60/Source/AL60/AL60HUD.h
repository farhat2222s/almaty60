#pragma once
#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "AL60HUD.generated.h"
UCLASS()
class AL60_API AAL60HUD : public AHUD
{
    GENERATED_BODY()
public:
    virtual void DrawHUD() override;
private:
    float UiScale=1.f;
    void TextLine(const FString& Text,float X,float Y,float Size,FLinearColor Color);
    float Paragraph(const FString& Text,float X,float Y,float Width,float Size,FLinearColor Color);
};
