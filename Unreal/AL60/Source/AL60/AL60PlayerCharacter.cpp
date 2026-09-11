#include "AL60PlayerCharacter.h"
#include "AL60CityWorld.h"
#include "AL60MissionManager.h"
#include "AL60PlayerController.h"
#include "AL60VehiclePawn.h"
#include "Camera/CameraComponent.h"
#include "Components/InputComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "EngineUtils.h"

AAL60PlayerCharacter::AAL60PlayerCharacter()
{
    CameraBoom=CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
    CameraBoom->SetupAttachment(RootComponent);
    CameraBoom->TargetArmLength=510.f;
    CameraBoom->SocketOffset=FVector(0,52,76);
    CameraBoom->bUsePawnControlRotation=true;
    CameraBoom->bDoCollisionTest=true;
    CameraBoom->ProbeSize=16.f;
    CameraBoom->bEnableCameraLag=true;
    CameraBoom->CameraLagSpeed=10.f;
    CameraBoom->CameraLagMaxDistance=65.f;
    FollowCamera=CreateDefaultSubobject<UCameraComponent>(TEXT("FollowCamera"));
    FollowCamera->SetupAttachment(CameraBoom,USpringArmComponent::SocketName);
    FollowCamera->bUsePawnControlRotation=false;
    FollowCamera->FieldOfView=78.f;
}

void AAL60PlayerCharacter::SetupPlayerInputComponent(UInputComponent* Input)
{
    Super::SetupPlayerInputComponent(Input);
    Input->BindAxis(TEXT("MoveForward"),this,&AAL60PlayerCharacter::MoveForward);
    Input->BindAxis(TEXT("MoveRight"),this,&AAL60PlayerCharacter::MoveRight);
    Input->BindAxis(TEXT("Turn"),this,&AAL60PlayerCharacter::Turn);
    Input->BindAxis(TEXT("LookUp"),this,&AAL60PlayerCharacter::LookUp);
    Input->BindAxis(TEXT("TurnRate"),this,&AAL60PlayerCharacter::TurnRate);
    Input->BindAxis(TEXT("LookUpRate"),this,&AAL60PlayerCharacter::LookUpRate);
    Input->BindAction(TEXT("Jump"),IE_Pressed,this,&ACharacter::Jump);
    Input->BindAction(TEXT("Jump"),IE_Released,this,&ACharacter::StopJumping);
    Input->BindAction(TEXT("Interact"),IE_Pressed,this,&AAL60PlayerCharacter::Interact);
    Input->BindAction(TEXT("Sprint"),IE_Pressed,this,&AAL60PlayerCharacter::StartSprint);
    Input->BindAction(TEXT("Sprint"),IE_Released,this,&AAL60PlayerCharacter::StopSprint);
    Input->BindAction(TEXT("Login"),IE_Pressed,this,&AAL60PlayerCharacter::ToggleLogin);
}

void AAL60PlayerCharacter::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    GetCharacterMovement()->MaxWalkSpeed=bSprinting?720.f:420.f;
    if (UGameInstance* GI=GetGameInstance())
    {
        if (UAL60MissionManager* Manager=GI->GetSubsystem<UAL60MissionManager>())
        {
            const FRotator Yaw(0,Controller?Controller->GetControlRotation().Yaw:0,0);
            const FVector WorldDirection=FRotationMatrix(Yaw).GetUnitAxis(EAxis::X)*ForwardInput+FRotationMatrix(Yaw).GetUnitAxis(EAxis::Y)*RightInput;
            const APlayerController* PC=Cast<APlayerController>(Controller);
            const bool bCanSendMovement=IsLocallyControlled() && PC && !PC->IsMoveInputIgnored();
            Manager->SetMovementInput(bCanSendMovement?FVector2D(WorldDirection.X,WorldDirection.Y):FVector2D::ZeroVector,bCanSendMovement && bSprinting);
            if (Manager->IsServerDriving())
            {
                // Prediction is visual only; server position determines checkpoints and rewards.
                const FVector ServerPosition=Manager->GetServerWorldPosition();
                const FVector Current=GetActorLocation();
                if (!bWasServerDriving || FVector::DistSquared2D(Current,ServerPosition)>FMath::Square(220.f))
                    SetActorLocation(FVector(ServerPosition.X,ServerPosition.Y,FMath::Max(96.0,Current.Z)),false,nullptr,ETeleportType::TeleportPhysics);
                else
                {
                    const FVector Correction=FMath::VInterpTo(Current,FVector(ServerPosition.X,ServerPosition.Y,Current.Z),DeltaSeconds,4.f);
                    SetActorLocation(Correction,true);
                }
            }
            bWasServerDriving=Manager->IsServerDriving();
        }
    }
    if (GetActorLocation().Z < -500.f) SetActorLocation(FVector(-6150,-350,150),false,nullptr,ETeleportType::TeleportPhysics);
}

void AAL60PlayerCharacter::MoveForward(float Value)
{
    ForwardInput=Value;
    if (!Controller || FMath::IsNearlyZero(Value)) return;
    AddMovementInput(FRotationMatrix(FRotator(0,Controller->GetControlRotation().Yaw,0)).GetUnitAxis(EAxis::X),Value);
}
void AAL60PlayerCharacter::MoveRight(float Value)
{
    RightInput=Value;
    if (!Controller || FMath::IsNearlyZero(Value)) return;
    AddMovementInput(FRotationMatrix(FRotator(0,Controller->GetControlRotation().Yaw,0)).GetUnitAxis(EAxis::Y),Value);
}
void AAL60PlayerCharacter::Turn(float Value) { AddControllerYawInput(Value); }
void AAL60PlayerCharacter::LookUp(float Value) { AddControllerPitchInput(Value); }
void AAL60PlayerCharacter::TurnRate(float Value) { AddControllerYawInput(Value*75.f*GetWorld()->GetDeltaSeconds()); }
void AAL60PlayerCharacter::LookUpRate(float Value) { AddControllerPitchInput(Value*60.f*GetWorld()->GetDeltaSeconds()); }
void AAL60PlayerCharacter::StartSprint() { bSprinting=true; }
void AAL60PlayerCharacter::StopSprint() { bSprinting=false; }
void AAL60PlayerCharacter::Interact()
{
    for (TActorIterator<AAL60CityWorld> It(GetWorld()); It; ++It)
        if (It->IsDialogueOpen()) { It->Interact(this); return; }
    for (TActorIterator<AAL60VehiclePawn> It(GetWorld()); It; ++It)
        if (It->CanEnter(this)) { It->TryEnter(this); return; }
    for (TActorIterator<AAL60CityWorld> It(GetWorld()); It; ++It) { It->Interact(this); break; }
}
void AAL60PlayerCharacter::ToggleLogin()
{
    if (AAL60PlayerController* PC=Cast<AAL60PlayerController>(GetController())) PC->ToggleLogin();
}
