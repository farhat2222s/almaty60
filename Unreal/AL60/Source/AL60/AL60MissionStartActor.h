#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AL60MissionStartActor.generated.h"

class UBoxComponent;
class UStaticMeshComponent;

UCLASS()
class AL60_API AAL60MissionStartActor : public AActor
{
    GENERATED_BODY()

public:
    AAL60MissionStartActor();

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Mission")
    FString MissionId = TEXT("m_demo_60_checkpoint_run");

protected:
    virtual void BeginPlay() override;

private:
    UPROPERTY(VisibleAnywhere) UStaticMeshComponent* Mesh;
    UPROPERTY(VisibleAnywhere) UBoxComponent* Trigger;

    UFUNCTION() void OnOverlap(
        UPrimitiveComponent* OverlappedComponent,
        AActor* OtherActor,
        UPrimitiveComponent* OtherComp,
        int32 OtherBodyIndex,
        bool bFromSweep,
        const FHitResult& SweepResult);
};
