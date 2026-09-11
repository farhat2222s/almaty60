#include "AL60VehiclePawn.h"
#include "AL60PlayerCharacter.h"
#include "AL60MissionManager.h"
#include "Components/BoxComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Components/InputComponent.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

AAL60VehiclePawn::AAL60VehiclePawn()
{
    PrimaryActorTick.bCanEverTick=true;
    Chassis=CreateDefaultSubobject<UBoxComponent>(TEXT("Chassis"));
    Chassis->InitBoxExtent(FVector(195,90,55));
    Chassis->SetCollisionProfileName(TEXT("BlockAll"));
    Chassis->SetCollisionObjectType(ECC_Pawn);
    RootComponent=Chassis;
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    auto Part=[&](const TCHAR* Name,FVector P,FVector Size)
    {
        UStaticMeshComponent* Mesh=CreateDefaultSubobject<UStaticMeshComponent>(Name);
        Mesh->SetupAttachment(Chassis); Mesh->SetStaticMesh(Cube.Object);
        Mesh->SetRelativeLocation(P); Mesh->SetRelativeScale3D(Size/100.f);
        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        return Mesh;
    };
    BodyParts.Add(Part(TEXT("Body"),FVector(0,0,-2),FVector(390,176,70)));
    BodyParts.Add(Part(TEXT("Cabin"),FVector(-25,0,54),FVector(200,155,86)));
    BodyParts.Add(Part(TEXT("Roof"),FVector(-30,0,99),FVector(175,157,12)));
    GlassParts.Add(Part(TEXT("Windshield"),FVector(78,0,63),FVector(8,143,57)));
    GlassParts.Add(Part(TEXT("RearWindow"),FVector(-128,0,64),FVector(8,142,52)));
    GlassParts.Add(Part(TEXT("LeftWindow"),FVector(-24,-80,63),FVector(167,6,54)));
    GlassParts.Add(Part(TEXT("RightWindow"),FVector(-24,80,63),FVector(167,6,54)));
    DarkParts.Add(Part(TEXT("FrontBumper"),FVector(197,0,-14),FVector(15,180,24)));
    DarkParts.Add(Part(TEXT("RearBumper"),FVector(-197,0,-14),FVector(15,180,24)));
    DarkParts.Add(Part(TEXT("LeftPillar"),FVector(-12,-85,66),FVector(15,9,67)));
    DarkParts.Add(Part(TEXT("RightPillar"),FVector(-12,85,66),FVector(15,9,67)));
    BrightParts.Add(Part(TEXT("LeftHeadlight"),FVector(202,-61,10),FVector(8,37,23)));
    BrightParts.Add(Part(TEXT("RightHeadlight"),FVector(202,61,10),FVector(8,37,23)));
    for (int I=0; I<4; ++I)
    {
        USceneComponent* Pivot=CreateDefaultSubobject<USceneComponent>(*FString::Printf(TEXT("WheelPivot%d"),I));
        Pivot->SetupAttachment(Chassis);
        Pivot->SetRelativeLocation(FVector(I<2?122:-125,I%2?91:-91,-45));
        UStaticMeshComponent* Wheel=CreateDefaultSubobject<UStaticMeshComponent>(*FString::Printf(TEXT("Wheel%d"),I));
        Wheel->SetupAttachment(Pivot); Wheel->SetStaticMesh(Cylinder.Object);
        Wheel->SetRelativeScale3D(FVector(.68f,.68f,.28f));
        Wheel->SetRelativeRotation(FRotator(0,0,90));
        Wheel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        DarkParts.Add(Wheel); WheelMeshes.Add(Wheel);
        if (I<2) FrontWheelPivots.Add(Pivot);
    }
    CameraBoom=CreateDefaultSubobject<USpringArmComponent>(TEXT("VehicleCameraBoom"));
    CameraBoom->SetupAttachment(Chassis); CameraBoom->TargetArmLength=700;
    CameraBoom->SocketOffset=FVector(0,0,155); CameraBoom->bUsePawnControlRotation=true;
    CameraBoom->bDoCollisionTest=true; CameraBoom->ProbeSize=18;
    CameraBoom->bEnableCameraLag=true; CameraBoom->CameraLagSpeed=6.f;
    CameraBoom->CameraLagMaxDistance=90.f;
    FollowCamera=CreateDefaultSubobject<UCameraComponent>(TEXT("VehicleCamera"));
    FollowCamera->SetupAttachment(CameraBoom,USpringArmComponent::SocketName);
    FollowCamera->FieldOfView=84;
}

void AAL60VehiclePawn::BeginPlay()
{
    Super::BeginPlay();
    UMaterialInterface* Base=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/Materials/M_AL60_Palette.M_AL60_Palette"));
    if (!Base) Base=LoadObject<UMaterialInterface>(nullptr,TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
    if (!Base) return;
    auto Paint=[&](TArray<UStaticMeshComponent*>& Parts,FLinearColor Color)
    {
        UMaterialInstanceDynamic* Material=UMaterialInstanceDynamic::Create(Base,this);
        Material->SetVectorParameterValue(TEXT("Tint"),Color); Material->SetVectorParameterValue(TEXT("Color"),Color);
        for (UStaticMeshComponent* Mesh : Parts) Mesh->SetMaterial(0,Material);
    };
    Paint(BodyParts,BodyColor); Paint(GlassParts,FLinearColor(.025f,.14f,.21f));
    Paint(DarkParts,FLinearColor(.022f,.028f,.04f)); Paint(BrightParts,FLinearColor(1.f,.9f,.57f));
}

void AAL60VehiclePawn::SetupPlayerInputComponent(UInputComponent* Input)
{
    Super::SetupPlayerInputComponent(Input);
    Input->BindAxis(TEXT("MoveForward"),this,&AAL60VehiclePawn::SetThrottle);
    Input->BindAxis(TEXT("MoveRight"),this,&AAL60VehiclePawn::SetSteering);
    Input->BindAxis(TEXT("Turn"),this,&AAL60VehiclePawn::Turn);
    Input->BindAxis(TEXT("LookUp"),this,&AAL60VehiclePawn::LookUp);
    Input->BindAxis(TEXT("TurnRate"),this,&AAL60VehiclePawn::TurnRate);
    Input->BindAxis(TEXT("LookUpRate"),this,&AAL60VehiclePawn::LookUpRate);
    Input->BindAction(TEXT("Interact"),IE_Pressed,this,&AAL60VehiclePawn::TryExit);
    Input->BindAction(TEXT("Jump"),IE_Pressed,this,&AAL60VehiclePawn::BrakePressed);
    Input->BindAction(TEXT("Jump"),IE_Released,this,&AAL60VehiclePawn::BrakeReleased);
    Input->BindAction(TEXT("Sprint"),IE_Pressed,this,&AAL60VehiclePawn::AcceleratorPressed);
    Input->BindAction(TEXT("Sprint"),IE_Released,this,&AAL60VehiclePawn::AcceleratorReleased);
}

bool AAL60VehiclePawn::CanEnter(const AAL60PlayerCharacter* Player) const
{
    return Player && !Driver && !GetController() && Player->IsPlayerControlled()
        && FVector::DistSquared2D(Player->GetActorLocation(),GetActorLocation())<=FMath::Square(330.f);
}

bool AAL60VehiclePawn::TryEnter(AAL60PlayerCharacter* Player)
{
    if (!CanEnter(Player)) return false;
    if (UGameInstance* GI=GetGameInstance())
        if (UAL60MissionManager* Manager=GI->GetSubsystem<UAL60MissionManager>())
        {
            const EAL60MissionStatus State=Manager->GetState().Status;
            if (State==EAL60MissionStatus::Active || State==EAL60MissionStatus::Starting || State==EAL60MissionStatus::Verifying)
            { StatusMessage=TEXT("Сначала завершите пешее серверное испытание."); return false; }
        }
    APlayerController* PC=Cast<APlayerController>(Player->GetController());
    if (!PC) return false;
    Driver=Player;
    Driver->StopSprint(); Driver->StopJumping();
    Driver->GetCharacterMovement()->StopMovementImmediately(); Driver->GetCharacterMovement()->DisableMovement();
    Driver->SetActorEnableCollision(false); Driver->SetActorHiddenInGame(true);
    SignedSpeed=0; Throttle=0; Steering=0; bHandbrake=false; bAcceleratorHeld=false;
    PC->Possess(this); PC->SetControlRotation(FRotator(-12,GetActorRotation().Yaw,0));
    StatusMessage.Empty();
    return true;
}

bool AAL60VehiclePawn::FindSafeExit(FVector& OutLocation) const
{
    if (!Driver) return false;
    const float Radius=Driver->GetCapsuleComponent()->GetScaledCapsuleRadius()+6.f;
    const float HalfHeight=Driver->GetCapsuleComponent()->GetScaledCapsuleHalfHeight();
    FCollisionQueryParams Params(SCENE_QUERY_STAT(AL60SafeVehicleExit),false,this);
    Params.AddIgnoredActor(Driver);
    const TArray<FVector> Offsets={FVector(0,-205,0),FVector(0,205,0),FVector(-330,0,0),FVector(330,0,0)};
    for (const FVector& Offset : Offsets)
    {
        const FVector Candidate=GetActorLocation()+GetActorRotation().RotateVector(Offset);
        FHitResult Ground;
        if (!GetWorld()->LineTraceSingleByChannel(Ground,Candidate+FVector(0,0,210),Candidate-FVector(0,0,420),ECC_Visibility,Params)
            || Ground.bStartPenetrating || Ground.ImpactNormal.Z<.75f
            || FMath::Abs(Ground.ImpactPoint.Z-(GetActorLocation().Z-85.f))>70.f) continue;
        const FVector Exit=Ground.ImpactPoint+FVector(0,0,HalfHeight+3.f);
        // Reject walls, props and other pedestrians before making the character visible/collidable.
        const FCollisionShape Capsule=FCollisionShape::MakeCapsule(Radius,HalfHeight);
        const FVector DoorPathStart=GetActorLocation()+FVector(0,0,HalfHeight-85.f+3.f);
        FHitResult ExitPath;
        if (!GetWorld()->OverlapBlockingTestByChannel(Exit,FQuat::Identity,ECC_Pawn,Capsule,Params)
            && !GetWorld()->SweepSingleByChannel(ExitPath,DoorPathStart,Exit,FQuat::Identity,ECC_Pawn,Capsule,Params))
        { OutLocation=Exit; return true; }
    }
    return false;
}

void AAL60VehiclePawn::TryExit()
{
    if (!Driver) return;
    if (FMath::Abs(SignedSpeed)>80.f) { StatusMessage=TEXT("Остановитесь перед выходом: пробел / тормоз."); return; }
    FVector Exit;
    if (!FindSafeExit(Exit)) { StatusMessage=TEXT("Выход заблокирован. Переставьте автомобиль на свободное место."); return; }
    APlayerController* PC=Cast<APlayerController>(GetController());
    if (!PC) return;
    AAL60PlayerCharacter* ReturningPlayer=Driver;
    SignedSpeed=0; Throttle=0; Steering=0; bAcceleratorHeld=false; bHandbrake=false;
    ReturningPlayer->SetActorLocation(Exit,false,nullptr,ETeleportType::TeleportPhysics);
    ReturningPlayer->SetActorRotation(FRotator(0,GetActorRotation().Yaw,0));
    ReturningPlayer->SetActorEnableCollision(true); ReturningPlayer->SetActorHiddenInGame(false);
    ReturningPlayer->GetCharacterMovement()->SetMovementMode(MOVE_Walking);
    PC->Possess(ReturningPlayer); PC->SetControlRotation(FRotator(-13,GetActorRotation().Yaw,0));
    Driver=nullptr; StatusMessage.Empty();
}

void AAL60VehiclePawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!Driver || !GetController()) return;
    const float Dt=FMath::Min(DeltaSeconds,.05f);
    const float Input=bAcceleratorHeld && FMath::IsNearlyZero(Throttle)?1.f:Throttle;
    if (bHandbrake) SignedSpeed=FMath::FInterpConstantTo(SignedSpeed,0.f,Dt,1550.f);
    else if (FMath::Abs(Input)>.02f)
    {
        const bool bBraking=SignedSpeed*Input<0;
        SignedSpeed+=Input*(bBraking?1150.f:560.f)*Dt;
        SignedSpeed=FMath::Clamp(SignedSpeed,-440.f,1400.f);
    }
    else SignedSpeed=FMath::FInterpConstantTo(SignedSpeed,0.f,Dt,240.f);
    FCollisionQueryParams Params(SCENE_QUERY_STAT(AL60VehicleMovement),false,this); Params.AddIgnoredActor(Driver);
    FRotator Rotation=GetActorRotation();
    Rotation.Yaw+=Steering*53.f*FMath::Clamp(SignedSpeed/620.f,-.8f,1.f)*Dt;
    // UE's location sweep does not sweep rotation: validate the proposed chassis rotation separately.
    if (!GetWorld()->OverlapBlockingTestByChannel(GetActorLocation(),Rotation.Quaternion(),ECC_Pawn,FCollisionShape::MakeBox(Chassis->GetScaledBoxExtent()),Params))
        SetActorRotation(Rotation);
    else SignedSpeed*=.8f;
    FHitResult Hit;
    AddActorWorldOffset(GetActorForwardVector()*SignedSpeed*Dt,true,&Hit);
    if (Hit.bBlockingHit) SignedSpeed=0;
    FHitResult Ground;
    const FVector P=GetActorLocation();
    if (GetWorld()->LineTraceSingleByChannel(Ground,P+FVector(0,0,120),P-FVector(0,0,450),ECC_Visibility,Params)
        && Ground.ImpactNormal.Z>.75f)
    {
        const float GroundZ=Ground.ImpactPoint.Z+85.f;
        if (FMath::Abs(GroundZ-P.Z)<85.f)
            SetActorLocation(FVector(P.X,P.Y,FMath::FInterpTo(static_cast<float>(P.Z),GroundZ,Dt,12.f)),true);
    }
    WheelAngle=FMath::Fmod(WheelAngle+SignedSpeed*Dt*1.65f,360.f);
    for (UStaticMeshComponent* Wheel : WheelMeshes) Wheel->SetRelativeRotation(FRotator(WheelAngle,0,90));
    for (USceneComponent* Pivot : FrontWheelPivots) Pivot->SetRelativeRotation(FRotator(0,Steering*27.f,0));
    // Keep the hidden driver with the vehicle; no stale actor remains at the original parking place.
    Driver->SetActorLocation(GetActorLocation(),false,nullptr,ETeleportType::TeleportPhysics);
}
void AAL60VehiclePawn::SetThrottle(float Value) { Throttle=FMath::Clamp(Value,-1.f,1.f); }
void AAL60VehiclePawn::SetSteering(float Value) { Steering=FMath::Clamp(Value,-1.f,1.f); }
void AAL60VehiclePawn::Turn(float Value) { AddControllerYawInput(Value); }
void AAL60VehiclePawn::LookUp(float Value) { AddControllerPitchInput(Value); }
void AAL60VehiclePawn::TurnRate(float Value) { AddControllerYawInput(Value*75.f*GetWorld()->GetDeltaSeconds()); }
void AAL60VehiclePawn::LookUpRate(float Value) { AddControllerPitchInput(Value*60.f*GetWorld()->GetDeltaSeconds()); }
void AAL60VehiclePawn::BrakePressed() { SetHandbrake(true); }
void AAL60VehiclePawn::BrakeReleased() { SetHandbrake(false); }
void AAL60VehiclePawn::AcceleratorPressed() { SetAcceleratorHeld(true); }
void AAL60VehiclePawn::AcceleratorReleased() { SetAcceleratorHeld(false); }
