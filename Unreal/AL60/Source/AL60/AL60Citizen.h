#pragma once
#include "CoreMinimal.h"
#include "AL60HumanoidCharacter.h"
#include "AL60Citizen.generated.h"
class UTextRenderComponent;

UCLASS()
class AL60_API AAL60Citizen : public AAL60HumanoidCharacter
{
    GENERATED_BODY()
public:
    AAL60Citizen();
    virtual void Tick(float DeltaSeconds) override;
    void Configure(FName InId, const FString& InName, FVector InPatrolEnd, FLinearColor Color);
    FName CitizenId;
    FString DisplayName;
protected:
    virtual void BeginPlay() override;
private:
    UPROPERTY() UTextRenderComponent* NameLabel;
    FVector PatrolStart = FVector::ZeroVector;
    FVector PatrolEnd = FVector::ZeroVector;
    bool bReturning = false;
};
