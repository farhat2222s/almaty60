#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "AL60HumanoidCharacter.generated.h"

class UStaticMeshComponent;
class USceneComponent;

// Original procedural mannequin. Replace with a licensed skeletal character at art production.
UCLASS()
class AL60_API AAL60HumanoidCharacter : public ACharacter
{
    GENERATED_BODY()
public:
    AAL60HumanoidCharacter();
    virtual void Tick(float DeltaSeconds) override;
    UPROPERTY(EditAnywhere, Category="Appearance") FLinearColor JacketColor = FLinearColor(0.035f, 0.14f, 0.24f);
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
private:
    float WalkPhase = 0.f;
    bool bHasParcel = false;
};
