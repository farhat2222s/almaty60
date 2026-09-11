#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AL60CityWorld.generated.h"
class UInstancedStaticMeshComponent;
class UStaticMeshComponent;
class UMaterialInterface;
class UTextRenderComponent;
class AAL60Citizen;
class AAL60PlayerCharacter;
class AAL60CheckpointActor;
class UAL60CitySaveGame;

struct FAL60Landmark
{
    FName Id;
    FString Name;
    FVector Position;
};

UCLASS()
class AL60_API AAL60CityWorld : public AActor
{
    GENERATED_BODY()
public:
    AAL60CityWorld();
    virtual void Tick(float DeltaSeconds) override;
    void Interact(AAL60PlayerCharacter* Player);
    FString GetInteractionPrompt(const FVector& Position) const;
    FString GetQuestTitle() const;
    FString GetQuestObjective() const;
    FVector GetObjectiveLocation() const;
    FString GetDialogueSpeaker() const { return DialogueSpeaker; }
    FString GetDialogueText() const { return DialogueText; }
    bool IsDialogueOpen() const { return !DialogueText.IsEmpty(); }
    int32 GetXp() const;
    int32 GetCoins() const;
    int32 GetDiscoveredCount() const;
    int32 GetCompletedQuestCount() const;
    FString GetToast() const { return ToastText; }
    const TArray<FAL60Landmark>& GetLandmarks() const { return Landmarks; }
protected:
    virtual void BeginPlay() override;
private:
    UPROPERTY() TMap<FString, UInstancedStaticMeshComponent*> Geometry;
    UPROPERTY() UMaterialInterface* PaletteMaterial;
    UPROPERTY() UMaterialInterface* UnlitMaterial;
    UPROPERTY() TArray<AAL60Citizen*> Citizens;
    UPROPERTY() TArray<AAL60CheckpointActor*> BrandGates;
    UPROPERTY() TArray<UStaticMeshComponent*> SearchObjects;
    UPROPERTY() UAL60CitySaveGame* Save;
    TArray<FAL60Landmark> Landmarks;
    TArray<FVector> SearchPositions;
    TArray<FVector> ParkourPositions;
    FName ActiveQuest;
    FName PendingQuest;
    int32 QuestStep = 0;
    double ParkourDeadline = 0.0;
    TSet<int32> FoundItems;
    FString DialogueSpeaker;
    FString DialogueText;
    FString ToastText;
    double ToastUntil = 0.0;
    void BuildCity();
    void BuildLighting();
    void BuildActivities();
    void Box(const FString& Group, FVector Center, FVector Size, FLinearColor Color, bool bCollision = true, FRotator Rotation = FRotator::ZeroRotator);
    void Shape(const FString& Group, const TCHAR* AssetPath, FVector Center, FVector Size, FLinearColor Color, bool bCollision, FRotator Rotation, bool bUnlit = false);
    void Label(const FString& Text, FVector Position, FRotator Rotation, float Size = 70.f, FColor Color = FColor(255,213,75));
    AAL60Citizen* AddCitizen(FName Id, const FString& Name, FVector Position, FVector PatrolEnd, FLinearColor Jacket);
    void BeginQuest(FName Id, AAL60PlayerCharacter* Player);
    void CompleteQuest(AAL60PlayerCharacter* Player);
    void Notify(const FString& Text);
    void SaveProgress();
};
