#include "AL60HumanoidCharacter.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimSequence.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Modules/ModuleManager.h"

AAL60HumanoidCharacter::AAL60HumanoidCharacter()
{
    PrimaryActorTick.bCanEverTick = true;
    GetCapsuleComponent()->InitCapsuleSize(32.f, 92.f);
    GetCharacterMovement()->MaxWalkSpeed = 420.f;
    GetCharacterMovement()->JumpZVelocity = 620.f;
    GetCharacterMovement()->AirControl = 0.35f;
    GetCharacterMovement()->MaxStepHeight = 38.f;
    GetCharacterMovement()->bOrientRotationToMovement = true;
    GetCharacterMovement()->RotationRate = FRotator(0.f, 600.f, 0.f);
    bUseControllerRotationYaw = false;

    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Sphere(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    FigureRoot = CreateDefaultSubobject<USceneComponent>(TEXT("FigureRoot"));
    FigureRoot->SetupAttachment(RootComponent);
    FigureRoot->SetRelativeLocation(FVector(0.f, 0.f, -92.f));

    auto Part = [&](const TCHAR* Name, USceneComponent* Parent, FVector Location, FVector Size, bool bRound = false)
    {
        UStaticMeshComponent* Mesh = CreateDefaultSubobject<UStaticMeshComponent>(Name);
        Mesh->SetupAttachment(Parent);
        Mesh->SetStaticMesh(bRound ? Sphere.Object : Cube.Object);
        Mesh->SetRelativeLocation(Location);
        Mesh->SetRelativeScale3D(Size / 100.f);
        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Mesh->SetCastShadow(true);
        return Mesh;
    };
    JacketParts.Add(Part(TEXT("Jacket"), FigureRoot, FVector(0,0,113), FVector(35,54,58)));
    DarkParts.Add(Part(TEXT("Hips"), FigureRoot, FVector(0,0,77), FVector(33,45,20)));
    SkinParts.Add(Part(TEXT("Head"), FigureRoot, FVector(0,0,164), FVector(35,33,40), true));
    DarkParts.Add(Part(TEXT("Hair"), FigureRoot, FVector(-3,0,176), FVector(34,34,18), true));
    AccentParts.Add(Part(TEXT("Collar"), FigureRoot, FVector(3,0,142), FVector(33,42,8)));
    DarkParts.Add(Part(TEXT("Backpack"), FigureRoot, FVector(-25,0,111), FVector(20,37,43)));
    AccentParts.Add(Part(TEXT("BackpackStripe"), FigureRoot, FVector(-36,0,113), FVector(2,27,6)));

    LeftArm = CreateDefaultSubobject<USceneComponent>(TEXT("LeftArmJoint"));
    LeftArm->SetupAttachment(FigureRoot); LeftArm->SetRelativeLocation(FVector(0,-36,135));
    RightArm = CreateDefaultSubobject<USceneComponent>(TEXT("RightArmJoint"));
    RightArm->SetupAttachment(FigureRoot); RightArm->SetRelativeLocation(FVector(0,36,135));
    JacketParts.Add(Part(TEXT("LeftSleeve"), LeftArm, FVector(0,0,-22), FVector(18,18,45)));
    JacketParts.Add(Part(TEXT("RightSleeve"), RightArm, FVector(0,0,-22), FVector(18,18,45)));
    SkinParts.Add(Part(TEXT("LeftHand"), LeftArm, FVector(0,0,-49), FVector(17,16,15), true));
    SkinParts.Add(Part(TEXT("RightHand"), RightArm, FVector(0,0,-49), FVector(17,16,15), true));
    LeftLeg = CreateDefaultSubobject<USceneComponent>(TEXT("LeftLegJoint"));
    LeftLeg->SetupAttachment(FigureRoot); LeftLeg->SetRelativeLocation(FVector(0,-14,72));
    RightLeg = CreateDefaultSubobject<USceneComponent>(TEXT("RightLegJoint"));
    RightLeg->SetupAttachment(FigureRoot); RightLeg->SetRelativeLocation(FVector(0,14,72));
    DarkParts.Add(Part(TEXT("LeftTrouser"), LeftLeg, FVector(0,0,-29), FVector(20,21,57)));
    DarkParts.Add(Part(TEXT("RightTrouser"), RightLeg, FVector(0,0,-29), FVector(20,21,57)));
    AccentParts.Add(Part(TEXT("LeftShoe"), LeftLeg, FVector(8,0,-64), FVector(36,24,15)));
    AccentParts.Add(Part(TEXT("RightShoe"), RightLeg, FVector(8,0,-64), FVector(36,24,15)));
    // The parcel hangs off the capsule so it stays visible when the primitive figure is replaced by a skeletal mesh.
    Parcel = Part(TEXT("DeliveryParcel"), RootComponent, FVector(40,0,4), FVector(38,46,35));
    AccentParts.Add(Parcel);
    Parcel->SetVisibility(false);
}

void AAL60HumanoidCharacter::BeginPlay()
{
    Super::BeginPlay();
    UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_AL60_Palette.M_AL60_Palette"));
    if (!Base) Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
    if (!Base) return;
    auto Apply = [&](const TArray<UStaticMeshComponent*>& Parts, FLinearColor Color)
    {
        UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(Base, this);
        if (!Material) return;
        Material->SetVectorParameterValue(TEXT("Tint"), Color);
        Material->SetVectorParameterValue(TEXT("Color"), Color);
        for (UStaticMeshComponent* Part : Parts) Part->SetMaterial(0, Material);
    };
    Apply(JacketParts, JacketColor);
    Apply(DarkParts, FLinearColor(0.025f,0.04f,0.065f));
    Apply(SkinParts, FLinearColor(0.62f,0.36f,0.21f));
    Apply(AccentParts, FLinearColor(1.f,0.72f,0.055f));
    if (bUseSkeletalHero) TryLoadSkeletalHero();
}

bool AAL60HumanoidCharacter::TryLoadSkeletalHero()
{
    FAssetRegistryModule& Registry = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
    TArray<FAssetData> Assets;
    Registry.Get().GetAssetsByPath(FName(TEXT("/Game/Characters")), Assets, true);
    USkeletalMesh* Mesh = nullptr;
    for (const FAssetData& Asset : Assets)
    {
        if (Asset.AssetClassPath == USkeletalMesh::StaticClass()->GetClassPathName())
        {
            Mesh = Cast<USkeletalMesh>(Asset.GetAsset());
            if (Mesh) break;
        }
    }
    if (!Mesh) return false;
    for (const FAssetData& Asset : Assets)
    {
        if (Asset.AssetClassPath != UAnimSequence::StaticClass()->GetClassPathName()) continue;
        const FString Name = Asset.AssetName.ToString();
        UAnimSequence* Clip = Cast<UAnimSequence>(Asset.GetAsset());
        if (!Clip) continue;
        if (Name == TEXT("Idle") || (!IdleClip && Name.Contains(TEXT("Idle")))) IdleClip = Clip;
        else if (Name == TEXT("Walk") || (!WalkClip && Name.Contains(TEXT("Walk")))) WalkClip = Clip;
        else if (Name == TEXT("Run") || (!RunClip && Name.Contains(TEXT("Run")))) RunClip = Clip;
    }
    USkeletalMeshComponent* Body = GetMesh();
    Body->SetSkeletalMeshAsset(Mesh);
    const float Height = FMath::Max(1.f, static_cast<float>(Mesh->GetBounds().BoxExtent.Z) * 2.f);
    Body->SetRelativeScale3D(FVector(HeroHeightCentimeters / Height));
    Body->SetRelativeLocation(FVector(0.f, 0.f, -GetCapsuleComponent()->GetScaledCapsuleHalfHeight()));
    Body->SetRelativeRotation(FRotator(0.f, HeroMeshYaw, 0.f));
    Body->SetAnimationMode(EAnimationMode::AnimationSingleNode);
    Body->SetCastShadow(true);
    Body->SetVisibility(true, true);
    FigureRoot->SetVisibility(false, true);
    bHasSkeletalHero = true;
    PlayClip(IdleClip);
    return true;
}

void AAL60HumanoidCharacter::PlayClip(UAnimSequence* Clip)
{
    if (!Clip || Clip == CurrentClip) return;
    CurrentClip = Clip;
    GetMesh()->PlayAnimation(Clip, true);
}

void AAL60HumanoidCharacter::SetCarryingParcel(bool bCarrying)
{
    bHasParcel = bCarrying;
    Parcel->SetVisibility(bHasParcel);
}

void AAL60HumanoidCharacter::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    const float Speed = GetVelocity().Size2D();
    if (bHasSkeletalHero)
    {
        PlayClip(Speed > 520.f && RunClip ? RunClip : Speed > 20.f && WalkClip ? WalkClip : IdleClip);
        return;
    }
    const float Blend = FMath::Clamp(Speed / 420.f, 0.f, 1.5f);
    WalkPhase += DeltaSeconds * FMath::Lerp(2.f, 10.f, FMath::Min(Blend, 1.f));
    const float Swing = FMath::Sin(WalkPhase) * 28.f * Blend;
    const bool bFalling = GetCharacterMovement()->IsFalling();
    LeftLeg->SetRelativeRotation(FRotator(bFalling ? -24.f : Swing,0,0));
    RightLeg->SetRelativeRotation(FRotator(bFalling ? 28.f : -Swing,0,0));
    LeftArm->SetRelativeRotation(FRotator(bHasParcel ? -65.f : -Swing * 0.75f,0,-5.f));
    RightArm->SetRelativeRotation(FRotator(bHasParcel ? -65.f : Swing * 0.75f,0,5.f));
    FigureRoot->SetRelativeLocation(FVector(0,0,-92.f + (bFalling ? 0.f : FMath::Abs(FMath::Sin(WalkPhase)) * 2.f * Blend)));
}
