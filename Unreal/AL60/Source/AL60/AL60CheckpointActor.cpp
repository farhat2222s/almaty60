#include "AL60CheckpointActor.h"
#include "Components/BoxComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Components/TextRenderComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

AAL60CheckpointActor::AAL60CheckpointActor()
{
    PrimaryActorTick.bCanEverTick=false;
    RootComponent=CreateDefaultSubobject<USceneComponent>(TEXT("GateRoot"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    auto Part=[&](const TCHAR* Name,FVector Position,FVector Scale)
    {
        UStaticMeshComponent* Piece=CreateDefaultSubobject<UStaticMeshComponent>(Name);
        Piece->SetupAttachment(RootComponent); Piece->SetStaticMesh(Cube.Object);
        Piece->SetRelativeLocation(Position); Piece->SetRelativeScale3D(Scale);
        Piece->SetCollisionEnabled(ECollisionEnabled::NoCollision); GateParts.Add(Piece); return Piece;
    };
    Mesh=Part(TEXT("GateLeft"),FVector(0,-165,55),FVector(.22f,.22f,2.9f));
    Part(TEXT("GateRight"),FVector(0,165,55),FVector(.22f,.22f,2.9f));
    Part(TEXT("GateTop"),FVector(0,0,195),FVector(.22f,3.52f,.22f));
    Trigger=CreateDefaultSubobject<UBoxComponent>(TEXT("Trigger"));
    Trigger->SetupAttachment(RootComponent); Trigger->SetBoxExtent(FVector(160,160,160));
    // Checkpoints are awarded by server simulation; the visual arch never sends completion events.
    Trigger->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    SequenceLabel=CreateDefaultSubobject<UTextRenderComponent>(TEXT("SequenceLabel"));
    SequenceLabel->SetupAttachment(RootComponent); SequenceLabel->SetRelativeLocation(FVector(-20,0,227));
    SequenceLabel->SetRelativeRotation(FRotator(0,180,0)); SequenceLabel->SetHorizontalAlignment(EHTA_Center);
    SequenceLabel->SetWorldSize(60); SequenceLabel->SetTextRenderColor(FColor(255,210,60));
}
void AAL60CheckpointActor::BeginPlay()
{
    Super::BeginPlay();
    UMaterialInterface* Base=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/Materials/M_AL60_Unlit.M_AL60_Unlit"));
    if (!Base) Base=LoadObject<UMaterialInterface>(nullptr,TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
    if (!Base) return;
    GateMaterial=UMaterialInstanceDynamic::Create(Base,this);
    for (UStaticMeshComponent* Part : GateParts) Part->SetMaterial(0,GateMaterial);
    UpdateVisualState(false,false);
}
void AAL60CheckpointActor::UpdateVisualState(bool bComplete,bool bNext)
{
    if (GateMaterial)
    {
        const FLinearColor Color=bComplete?FLinearColor(.03f,.55f,.3f):bNext?FLinearColor(1.f,.72f,.03f):FLinearColor(.035f,.22f,.3f);
        GateMaterial->SetVectorParameterValue(TEXT("Tint"),Color); GateMaterial->SetVectorParameterValue(TEXT("Color"),Color);
    }
    SequenceLabel->SetText(FText::FromString(FString::FromInt(Sequence)));
}
void AAL60CheckpointActor::OnOverlap(UPrimitiveComponent*,AActor*,UPrimitiveComponent*,int32,bool,const FHitResult&) {}
