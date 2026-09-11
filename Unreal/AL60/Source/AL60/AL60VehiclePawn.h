#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "AL60VehiclePawn.generated.h"
class UBoxComponent;
class USpringArmComponent;
class UCameraComponent;
class UStaticMeshComponent;
class USceneComponent;
class AAL60PlayerCharacter;

// Original, deliberately simple car. Kinematic collision sweeps; no Chaos/GTA vehicle physics.
UCLASS()
class AL60_API AAL60VehiclePawn : public APawn
{
    GENERATED_BODY()
public:
    AAL60VehiclePawn();
    virtual void Tick(float DeltaSeconds) override;
    UPROPERTY(EditAnywhere, Category="Appearance") FLinearColor BodyColor=FLinearColor(1.f,.66f,.035f);
    bool CanEnter(const AAL60PlayerCharacter* Player) const;
    bool TryEnter(AAL60PlayerCharacter* Player);
    void TryExit();
    AAL60PlayerCharacter* GetDriver() const { return Driver; }
    float GetSpeedKph() const { return FMath::Abs(SignedSpeed)*.036f; }
    bool IsReversing() const { return SignedSpeed < -15.f; }
    FString GetStatusMessage() const { return StatusMessage; }
    void SetHandbrake(bool bPressed) { bHandbrake=bPressed; }
    void SetAcceleratorHeld(bool bPressed) { bAcceleratorHeld=bPressed; }
protected:
    virtual void BeginPlay() override;
    virtual void SetupPlayerInputComponent(UInputComponent* Input) override;
private:
    UPROPERTY() UBoxComponent* Chassis;
    UPROPERTY() USpringArmComponent* CameraBoom;
    UPROPERTY() UCameraComponent* FollowCamera;
    UPROPERTY() AAL60PlayerCharacter* Driver;
    UPROPERTY() TArray<UStaticMeshComponent*> BodyParts;
    UPROPERTY() TArray<UStaticMeshComponent*> GlassParts;
    UPROPERTY() TArray<UStaticMeshComponent*> DarkParts;
    UPROPERTY() TArray<UStaticMeshComponent*> BrightParts;
    UPROPERTY() TArray<UStaticMeshComponent*> WheelMeshes;
    UPROPERTY() TArray<USceneComponent*> FrontWheelPivots;
    float Throttle=0.f;
    float Steering=0.f;
    float SignedSpeed=0.f;
    float WheelAngle=0.f;
    bool bHandbrake=false;
    bool bAcceleratorHeld=false;
    FString StatusMessage;
    bool FindSafeExit(FVector& OutLocation) const;
    void SetThrottle(float Value);
    void SetSteering(float Value);
    void Turn(float Value);
    void LookUp(float Value);
    void TurnRate(float Value);
    void LookUpRate(float Value);
    void BrakePressed();
    void BrakeReleased();
    void AcceleratorPressed();
    void AcceleratorReleased();
};
