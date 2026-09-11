#include "AL60TouchControls.h"
#include "AL60PlayerCharacter.h"
#include "AL60PlayerController.h"
#include "AL60VehiclePawn.h"
#include "Blueprint/WidgetTree.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/Button.h"
#include "Components/TextBlock.h"
#include "UObject/ConstructorHelpers.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

void UAL60TouchControls::NativeOnInitialized()
{
    Super::NativeOnInitialized();
    if (!WidgetTree) WidgetTree=NewObject<UWidgetTree>(this);
    UCanvasPanel* Root=WidgetTree->ConstructWidget<UCanvasPanel>(); WidgetTree->RootWidget=Root;
    Root->SetVisibility(ESlateVisibility::SelfHitTestInvisible);
    SetVisibility(ESlateVisibility::SelfHitTestInvisible);
    auto Button=[&](const FString& Label,FVector2D Position,FVector2D Size,FLinearColor Color)
    {
        UButton* B=WidgetTree->ConstructWidget<UButton>(); B->SetBackgroundColor(Color);
        UTextBlock* T=WidgetTree->ConstructWidget<UTextBlock>(); T->SetText(FText::FromString(Label));
        T->SetColorAndOpacity(FSlateColor(FLinearColor(0.015f,0.04f,0.08f)));
        FSlateFontInfo Font=T->GetFont(); Font.Size=18; T->SetFont(Font); B->AddChild(T);
        UCanvasPanelSlot* Slot=Root->AddChildToCanvas(B); Slot->SetAnchors(FAnchors(1,1)); Slot->SetAlignment(FVector2D(1,1));
        Slot->SetPosition(Position); Slot->SetSize(Size); return B;
    };
    UButton* Jump=Button(TEXT("ПРЫЖОК"),FVector2D(-25,-285),FVector2D(135,60),FLinearColor(1,.75f,.06f));
    JumpText=Cast<UTextBlock>(Jump->GetContent());
    Jump->OnPressed.AddDynamic(this,&UAL60TouchControls::JumpPressed); Jump->OnReleased.AddDynamic(this,&UAL60TouchControls::JumpReleased);
    UButton* Action=Button(TEXT("ДЕЙСТВИЕ"),FVector2D(-175,-285),FVector2D(145,60),FLinearColor(.14f,.7f,.7f));
    ActionText=Cast<UTextBlock>(Action->GetContent());
    Action->OnPressed.AddDynamic(this,&UAL60TouchControls::InteractPressed);
    UButton* Sprint=Button(TEXT("БЕГ"),FVector2D(-25,-355),FVector2D(135,52),FLinearColor(.7f,.79f,.8f));
    SprintText=Cast<UTextBlock>(Sprint->GetContent());
    Sprint->OnPressed.AddDynamic(this,&UAL60TouchControls::SprintPressed); Sprint->OnReleased.AddDynamic(this,&UAL60TouchControls::SprintReleased);
    UButton* Login=Button(TEXT("ВОЙТИ"),FVector2D(-175,-355),FVector2D(145,52),FLinearColor(.7f,.79f,.8f));
    LoginControl=Login;
    Login->OnClicked.AddDynamic(this,&UAL60TouchControls::LoginPressed);
#if !(PLATFORM_IOS || PLATFORM_ANDROID)
    if (!FParse::Param(FCommandLine::Get(),TEXT("AL60Touch"))) SetVisibility(ESlateVisibility::Collapsed);
#endif
}
void UAL60TouchControls::NativeTick(const FGeometry& Geometry,float DeltaSeconds)
{
    Super::NativeTick(Geometry,DeltaSeconds);
    const bool bDriving=Cast<AAL60VehiclePawn>(GetOwningPlayerPawn())!=nullptr;
    if (JumpText) JumpText->SetText(FText::FromString(bDriving?TEXT("ТОРМОЗ"):TEXT("ПРЫЖОК")));
    if (ActionText) ActionText->SetText(FText::FromString(bDriving?TEXT("ВЫЙТИ"):TEXT("ДЕЙСТВИЕ")));
    if (SprintText) SprintText->SetText(FText::FromString(bDriving?TEXT("ГАЗ"):TEXT("БЕГ")));
    if (LoginControl) LoginControl->SetVisibility(bDriving?ESlateVisibility::Collapsed:ESlateVisibility::Visible);
}
void UAL60TouchControls::JumpPressed()
{
    if (AAL60VehiclePawn* Car=Cast<AAL60VehiclePawn>(GetOwningPlayerPawn())) Car->SetHandbrake(true);
    else if (AAL60PlayerCharacter* P=Cast<AAL60PlayerCharacter>(GetOwningPlayerPawn())) P->Jump();
}
void UAL60TouchControls::JumpReleased()
{
    if (AAL60VehiclePawn* Car=Cast<AAL60VehiclePawn>(GetOwningPlayerPawn())) Car->SetHandbrake(false);
    else if (AAL60PlayerCharacter* P=Cast<AAL60PlayerCharacter>(GetOwningPlayerPawn())) P->StopJumping();
}
void UAL60TouchControls::InteractPressed()
{
    if (AAL60VehiclePawn* Car=Cast<AAL60VehiclePawn>(GetOwningPlayerPawn())) Car->TryExit();
    else if (AAL60PlayerCharacter* P=Cast<AAL60PlayerCharacter>(GetOwningPlayerPawn())) P->Interact();
}
void UAL60TouchControls::SprintPressed()
{
    if (AAL60VehiclePawn* Car=Cast<AAL60VehiclePawn>(GetOwningPlayerPawn())) Car->SetAcceleratorHeld(true);
    else if (AAL60PlayerCharacter* P=Cast<AAL60PlayerCharacter>(GetOwningPlayerPawn())) P->StartSprint();
}
void UAL60TouchControls::SprintReleased()
{
    if (AAL60VehiclePawn* Car=Cast<AAL60VehiclePawn>(GetOwningPlayerPawn())) Car->SetAcceleratorHeld(false);
    else if (AAL60PlayerCharacter* P=Cast<AAL60PlayerCharacter>(GetOwningPlayerPawn())) P->StopSprint();
}
void UAL60TouchControls::LoginPressed() { if (AAL60PlayerController* PC=Cast<AAL60PlayerController>(GetOwningPlayer())) PC->ToggleLogin(); }
