#pragma once
#include "CoreMinimal.h"
#include "AL60HumanoidCharacter.h"
#include "AL60PlayerCharacter.generated.h"
class USpringArmComponent;
class UCameraComponent;

UCLASS()
class AL60_API AAL60PlayerCharacter : public AAL60HumanoidCharacter
{
    GENERATED_BODY()
public:
    AAL60PlayerCharacter();
    virtual void Tick(float DeltaSeconds) override;
    void Interact();
    void StartSprint();
    void StopSprint();
    void ToggleLogin();
protected:
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
private:
    UPROPERTY() USpringArmComponent* CameraBoom;
    UPROPERTY() UCameraComponent* FollowCamera;
    float ForwardInput=0.f;
    float RightInput=0.f;
    bool bSprinting=false;
    bool bWasServerDriving=false;
    void MoveForward(float Value);
    void MoveRight(float Value);
    void Turn(float Value);
    void LookUp(float Value);
    void TurnRate(float Value);
    void LookUpRate(float Value);
};
