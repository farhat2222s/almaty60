#include "AL60PlayerController.h"
#include "AL60TouchControls.h"
#include "AL60LoginWidget.h"
#include "Camera/PlayerCameraManager.h"
#include "GameFramework/TouchInterface.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

void AAL60PlayerController::BeginPlay()
{
    Super::BeginPlay();
    bEnableTouchEvents=true;
    if (PlayerCameraManager) { PlayerCameraManager->ViewPitchMin=-65.f; PlayerCameraManager->ViewPitchMax=25.f; }
    SetControlRotation(FRotator(-13.f,8.f,0));
    TouchControls=CreateWidget<UAL60TouchControls>(this,UAL60TouchControls::StaticClass());
    if (TouchControls) TouchControls->AddToViewport(10);
    if (FParse::Param(FCommandLine::Get(),TEXT("AL60Touch")))
    {
        ActivateTouchInterface(LoadObject<UTouchInterface>(nullptr,TEXT("/Engine/MobileResources/HUD/DefaultVirtualJoysticks.DefaultVirtualJoysticks")));
        SetVirtualJoystickVisibility(true);
    }
    SetInputMode(FInputModeGameOnly());
}
void AAL60PlayerController::ToggleLogin()
{
    if (LoginWidget && LoginWidget->IsInViewport()) { CloseLogin(); return; }
    LoginWidget=CreateWidget<UAL60LoginWidget>(this,UAL60LoginWidget::StaticClass());
    if (LoginWidget)
    {
        LoginWidget->AddToViewport(50);
        SetIgnoreMoveInput(true); SetIgnoreLookInput(true);
        FInputModeGameAndUI Mode; Mode.SetWidgetToFocus(LoginWidget->TakeWidget()); Mode.SetHideCursorDuringCapture(false);
        SetInputMode(Mode); bShowMouseCursor=true;
    }
}
void AAL60PlayerController::CloseLogin()
{
    if (LoginWidget) LoginWidget->RemoveFromParent();
    ResetIgnoreMoveInput(); ResetIgnoreLookInput();
    SetInputMode(FInputModeGameOnly()); bShowMouseCursor=false;
}
