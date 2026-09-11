#include "AL60Citizen.h"
#include "Components/TextRenderComponent.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Camera/PlayerCameraManager.h"

AAL60Citizen::AAL60Citizen()
{
    AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
    bUseSkeletalHero = false;
    GetCharacterMovement()->MaxWalkSpeed = 125.f;
    GetCharacterMovement()->bRunPhysicsWithNoController = true;
    GetCapsuleComponent()->SetCollisionResponseToChannel(ECC_Camera, ECR_Ignore);
    NameLabel = CreateDefaultSubobject<UTextRenderComponent>(TEXT("CitizenName"));
    NameLabel->SetupAttachment(RootComponent);
    NameLabel->SetRelativeLocation(FVector(0,0,125));
    NameLabel->SetHorizontalAlignment(EHTA_Center);
    NameLabel->SetWorldSize(26.f);
    NameLabel->SetTextRenderColor(FColor(255,207,72));
    NameLabel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void AAL60Citizen::Configure(FName InId, const FString& InName, FVector InPatrolEnd, FLinearColor Color)
{
    CitizenId = InId;
    DisplayName = InName;
    PatrolStart = GetActorLocation();
    PatrolEnd = InPatrolEnd;
    JacketColor = Color;
    NameLabel->SetText(FText::FromString(InName));
}

void AAL60Citizen::BeginPlay()
{
    Super::BeginPlay();
    PatrolStart = GetActorLocation();
    if (PatrolEnd.IsNearlyZero()) PatrolEnd = PatrolStart;
}

void AAL60Citizen::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (FVector::DistSquared2D(PatrolStart, PatrolEnd) > 10000.f)
    {
        const FVector Target = bReturning ? PatrolStart : PatrolEnd;
        if (FVector::DistSquared2D(GetActorLocation(), Target) < 10000.f) bReturning = !bReturning;
        AddMovementInput((Target - GetActorLocation()).GetSafeNormal2D());
    }
    if (APlayerCameraManager* Camera = UGameplayStatics::GetPlayerCameraManager(this, 0))
    {
        NameLabel->SetWorldRotation((Camera->GetCameraLocation() - NameLabel->GetComponentLocation()).Rotation());
    }
}
