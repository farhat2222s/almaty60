#pragma once
#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "AL60MissionManager.generated.h"
class FJsonObject;

UENUM(BlueprintType)
enum class EAL60MissionStatus : uint8 { Idle, Starting, Active, Verifying, Won, Failed };

USTRUCT(BlueprintType)
struct FAL60MissionState
{
    GENERATED_BODY()
    UPROPERTY(BlueprintReadOnly) FString MissionId;
    UPROPERTY(BlueprintReadOnly) FString AttemptId;
    UPROPERTY(BlueprintReadOnly) int32 TotalCheckpoints = 5;
    UPROPERTY(BlueprintReadOnly) int32 CompletedCheckpoints = 0;
    UPROPERTY(BlueprintReadOnly) int32 TimeLimitSeconds = 60;
    UPROPERTY(BlueprintReadOnly) int32 RewardXp = 0;
    UPROPERTY(BlueprintReadOnly) int32 RewardCoins = 0;
    UPROPERTY(BlueprintReadOnly) float ClientRemainingSeconds = 0.f;
    UPROPERTY(BlueprintReadOnly) FString RewardCode;
    UPROPERTY(BlueprintReadOnly) FString RewardExpiresAt;
    UPROPERTY(BlueprintReadOnly) EAL60MissionStatus Status = EAL60MissionStatus::Idle;
};
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FAL60MissionStateChanged, const FAL60MissionState&, State);

UCLASS()
class AL60_API UAL60MissionManager : public UGameInstanceSubsystem
{
    GENERATED_BODY()
public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;
    UPROPERTY(BlueprintAssignable) FAL60MissionStateChanged OnMissionStateChanged;
    UFUNCTION(BlueprintCallable) void StartMission(const FString& MissionId);
    UFUNCTION(BlueprintCallable) void RegisterCheckpoint(int32 Sequence);
    UFUNCTION(BlueprintCallable) void FinishMission();
    UFUNCTION(BlueprintCallable) void FailMission(const FString& Reason);
    // Returned by value: UHT does not accept reference return types on UFUNCTIONs.
    UFUNCTION(BlueprintPure) FAL60MissionState GetState() const { return State; }
    UFUNCTION(BlueprintPure) float GetRemainingSeconds() const;
    void Authenticate(const FString& Email, const FString& Password, const FString& Name, bool bRegister);
    void SyncAttempt();
    void SetMovementInput(FVector2D Direction, bool bSprint);
    bool IsAuthenticated() const { return !AccessToken.IsEmpty(); }
    bool IsServerDriving() const { return State.Status == EAL60MissionStatus::Active; }
    bool IsAuthenticating() const { return bAuthPending; }
    FString GetConnectionMessage() const { return ConnectionMessage; }
    FString GetBackendUrl() const { return BackendBaseUrl; }
    FString GetPlayerName() const { return PlayerName; }
    int32 GetServerXp() const { return ServerXp; }
    int32 GetServerCoins() const { return ServerCoins; }
    FVector GetServerWorldPosition() const;
    FVector GetNextCheckpointWorldPosition() const;
private:
    FString BackendBaseUrl;
    FString AccessToken;
    FString PlayerName;
    FString ConnectionMessage;
    FString PendingMissionId;
    FString PendingStartKey;
    FAL60MissionState State;
    FVector RouteOrigin = FVector(-5200.f,0.f,96.f);
    FVector2D ServerPosition = FVector2D::ZeroVector;
    FVector2D DesiredDirection = FVector2D::ZeroVector;
    TArray<FVector2D> Targets;
    double LocalDeadline = 0.0;
    double NextNetworkRetry = 0.0;
    int32 LastInputSeq = 0;
    int32 ServerXp = 0;
    int32 ServerCoins = 0;
    FTSTicker::FDelegateHandle TickHandle;
    uint32 RequestGeneration = 0;
    bool bAuthPending = false;
    bool bStartPending = false;
    bool bNeedsSync = false;
    bool bInputPending = false;
    bool bFinishPending = false;
    bool bSyncPending = false;
    bool bWantsSprint = false;
    bool TickMission(float DeltaSeconds);
    void Broadcast();
    void ApplyAttempt(const TSharedPtr<FJsonObject>& Json);
    void SendStartRequest();
    void SendMovementRequest();
    void SendFinishRequest();
    void SendJsonRequest(const FString& Verb, const FString& Path, const TSharedPtr<FJsonObject>& Payload,
        TFunction<void(bool, int32, TSharedPtr<FJsonObject>)> Callback, const FString& IdempotencyKey = FString());
};
