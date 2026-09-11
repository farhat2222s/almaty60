#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "AL60HumanoidCharacter.generated.h"

class UStaticMeshComponent;
class USceneComponent;
class UAnimSequence;

// Original procedural mannequin. Replace with a licensed skeletal character at art production.
UCLASS()
class AL60_API AAL60HumanoidCharacter : public ACharacter
{
    GENERATED_BODY()
public:
    AAL60HumanoidCharacter();
    virtual void Tick(float DeltaSeconds) override;
    UPROPERTY(EditAnywhere, Category="Appearance") FLinearColor JacketColor = FLinearColor(0.035f, 0.14f, 0.24f);
    // When a skeletal mesh exists under /Game/Characters (imported by Scripts/bootstrap_arbat.py), use it with its Idle/Walk/Run clips.
    UPROPERTY(EditAnywhere, Category="Appearance") bool bUseSkeletalHero = true;
    UPROPERTY(EditAnywhere, Category="Appearance") float HeroMeshYaw = -90.f;
    UPROPERTY(EditAnywhere, Category="Appearance") float HeroHeightCentimeters = 176.f;
    bool HasSkeletalHero() const { return bHasSkeletalHero; }
    void SetCarryingParcel(bool bCarrying);
protected:
    virtual void BeginPlay() override;
    UPROPERTY() USceneComponent* FigureRoot;
    UPROPERTY() USceneComponent* LeftArm;
    UPROPERTY() USceneComponent* RightArm;
    UPROPERTY() USceneComponent* LeftLeg;
    UPROPERTY() USceneComponent* RightLeg;
    UPROPERTY() UStaticMeshComponent* Parcel;
    UPROPERTY() TArray<UStaticMeshComponent*> JacketParts;
    UPROPERTY() TArray<UStaticMeshComponent*> DarkParts;
    UPROPERTY() TArray<UStaticMeshComponent*> SkinParts;
    UPROPERTY() TArray<UStaticMeshComponent*> AccentParts;
    UPROPERTY() UAnimSequence* IdleClip;
    UPROPERTY() UAnimSequence* WalkClip;
    UPROPERTY() UAnimSequence* RunClip;
    UPROPERTY() UAnimSequence* CurrentClip;
    bool TryLoadSkeletalHero();
    void PlayClip(UAnimSequence* Clip);
private:
    float WalkPhase = 0.f;
    bool bHasParcel = false;
    bool bHasSkeletalHero = false;
};
