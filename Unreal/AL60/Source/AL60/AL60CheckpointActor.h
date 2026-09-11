#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AL60CheckpointActor.generated.h"

class UBoxComponent;
class UStaticMeshComponent;
class UMaterialInstanceDynamic;
class UTextRenderComponent;

UCLASS()
class AL60_API AAL60CheckpointActor : public AActor
{
    GENERATED_BODY()

public:
    AAL60CheckpointActor();
    void UpdateVisualState(bool bComplete, bool bNext);

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Mission")
    int32 Sequence = 1;

protected:
    virtual void BeginPlay() override;

private:
    UPROPERTY(VisibleAnywhere) UStaticMeshComponent* Mesh;
    UPROPERTY(VisibleAnywhere) UBoxComponent* Trigger;
    UPROPERTY() TArray<UStaticMeshComponent*> GateParts;
    UPROPERTY() UMaterialInstanceDynamic* GateMaterial;
    UPROPERTY() UTextRenderComponent* SequenceLabel;

    UFUNCTION() void OnOverlap(
        UPrimitiveComponent* OverlappedComponent,
        AActor* OtherActor,
        UPrimitiveComponent* OtherComp,
        int32 OtherBodyIndex,
        bool bFromSweep,
        const FHitResult& SweepResult);
};
