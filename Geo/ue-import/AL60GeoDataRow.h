#pragma once
#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "AL60GeoDataRow.generated.h"

USTRUCT(BlueprintType)
struct FAL60GeoRing
{
    GENERATED_BODY()
    UPROPERTY(EditAnywhere, BlueprintReadWrite) TArray<FVector> Vertices;
};

// Copy into a UE game module and compile before importing ue-datatable.json.
// Coordinates are centimeters: X east, Y south, Z up relative to Geo/origin.json.
USTRUCT(BlueprintType)
struct FAL60GeoDataRow : public FTableRowBase
{
    GENERATED_BODY()
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString SourceId;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Kind;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString DisplayName;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString GeometryType;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float HeightCm = 0.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) bool HeightEstimated = false;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString HeightSource;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString SourceUrl;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString SourceLicense;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString SourcePropertiesJson;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) TArray<FAL60GeoRing> Rings;
};
