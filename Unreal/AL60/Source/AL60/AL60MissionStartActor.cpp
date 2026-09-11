#include "AL60MissionStartActor.h"
#include "AL60MissionManager.h"
#include "Components/BoxComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "UObject/ConstructorHelpers.h"
#include "GameFramework/Character.h"
#include "Engine/GameInstance.h"
#include "AL60PlayerController.h"

AAL60MissionStartActor::AAL60MissionStartActor()
{
    PrimaryActorTick.bCanEverTick = false;

    Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    RootComponent = Mesh;
    static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeMesh(TEXT("/Engine/BasicShapes/Cube.Cube"));
    if (CubeMesh.Succeeded()) Mesh->SetStaticMesh(CubeMesh.Object);
    Mesh->SetRelativeScale3D(FVector(1.2f, 1.2f, 0.25f));
    Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    Trigger = CreateDefaultSubobject<UBoxComponent>(TEXT("Trigger"));
    Trigger->SetupAttachment(RootComponent);
    Trigger->SetBoxExtent(FVector(180.f, 180.f, 100.f));
    Trigger->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
    Trigger->SetCollisionResponseToAllChannels(ECR_Ignore);
    Trigger->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
}

void AAL60MissionStartActor::BeginPlay()
{
    Super::BeginPlay();
    Trigger->OnComponentBeginOverlap.AddDynamic(this, &AAL60MissionStartActor::OnOverlap);
}

void AAL60MissionStartActor::OnOverlap(UPrimitiveComponent*, AActor* OtherActor, UPrimitiveComponent*, int32, bool, const FHitResult&)
{
    ACharacter* Player = Cast<ACharacter>(OtherActor);
    if (!Player || !Player->IsPlayerControlled()) return;
    if (UGameInstance* GI = GetGameInstance())
    {
        if (UAL60MissionManager* Manager = GI->GetSubsystem<UAL60MissionManager>())
        {
            Manager->StartMission(MissionId);
            if (!Manager->IsAuthenticated())
                if (AAL60PlayerController* PC=Cast<AAL60PlayerController>(Player->GetController())) PC->ToggleLogin();
        }
    }
}
