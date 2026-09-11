#include "AL60CityWorld.h"
#include "AL60Citizen.h"
#include "AL60PlayerCharacter.h"
#include "AL60CitySaveGame.h"
#include "AL60CheckpointActor.h"
#include "AL60MissionStartActor.h"
#include "AL60MissionManager.h"
#include "AL60VehiclePawn.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "HAL/PlatformTime.h"

namespace
{
    const TCHAR* CubePath = TEXT("/Engine/BasicShapes/Cube.Cube");
    const TCHAR* SpherePath = TEXT("/Engine/BasicShapes/Sphere.Sphere");
    const TCHAR* CylinderPath = TEXT("/Engine/BasicShapes/Cylinder.Cylinder");
    const TCHAR* ConePath = TEXT("/Engine/BasicShapes/Cone.Cone");
    const FLinearColor Navy(0.025f,0.07f,0.12f);
    const FLinearColor Yellow(1.f,0.69f,0.035f);
    const FLinearColor Teal(0.045f,0.55f,0.55f);
    const FLinearColor Stone(0.5f,0.54f,0.53f);
    const FVector RouteOrigin(-5200.f,0.f,0.f);
}

AAL60CityWorld::AAL60CityWorld()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickInterval = 0.05f;
    RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("CityRoot"));
    RootComponent->SetMobility(EComponentMobility::Static);
}

void AAL60CityWorld::BeginPlay()
{
    Super::BeginPlay();
    PaletteMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_AL60_Palette.M_AL60_Palette"));
    UnlitMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_AL60_Unlit.M_AL60_Unlit"));
    if (!PaletteMaterial) PaletteMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
    if (!UnlitMaterial) UnlitMaterial = PaletteMaterial;
    Save = Cast<UAL60CitySaveGame>(UGameplayStatics::LoadGameFromSlot(TEXT("AL60_City_Demo_v1"), 0));
    if (!Save) Save = Cast<UAL60CitySaveGame>(UGameplayStatics::CreateSaveGameObject(UAL60CitySaveGame::StaticClass()));
    BuildCity();
    BuildLighting();
    BuildActivities();
    Notify(TEXT("Добро пожаловать на Арбат. Поговорите с Аружан у входа."));
}

void AAL60CityWorld::Shape(const FString& Group, const TCHAR* AssetPath, FVector Center, FVector Size, FLinearColor Color, bool bCollision, FRotator Rotation, bool bUnlit)
{
    UInstancedStaticMeshComponent* Mesh = Geometry.FindRef(Group);
    if (!Mesh)
    {
        Mesh = NewObject<UInstancedStaticMeshComponent>(this);
        Mesh->SetupAttachment(RootComponent);
        Mesh->SetMobility(EComponentMobility::Static);
        Mesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, AssetPath));
        Mesh->SetCollisionProfileName(bCollision ? TEXT("BlockAll") : TEXT("NoCollision"));
        Mesh->SetCastShadow(!bUnlit);
        Mesh->SetCullDistances(0, Group.StartsWith(TEXT("Mountain")) || Group == TEXT("Sky") ? 0 : 23000);
        UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(bUnlit ? UnlitMaterial : PaletteMaterial, this);
        if (Material)
        {
            Material->SetVectorParameterValue(TEXT("Tint"), Color);
            Material->SetVectorParameterValue(TEXT("Color"), Color);
            Mesh->SetMaterial(0, Material);
        }
        AddInstanceComponent(Mesh);
        Mesh->RegisterComponent();
        Geometry.Add(Group, Mesh);
    }
    Mesh->AddInstance(FTransform(Rotation, Center, Size / 100.f));
}

void AAL60CityWorld::Box(const FString& Group, FVector Center, FVector Size, FLinearColor Color, bool bCollision, FRotator Rotation)
{
    Shape(Group, CubePath, Center, Size, Color, bCollision, Rotation);
}

void AAL60CityWorld::Label(const FString& Text, FVector Position, FRotator Rotation, float Size, FColor Color)
{
    UTextRenderComponent* Render = NewObject<UTextRenderComponent>(this);
    Render->SetupAttachment(RootComponent);
    Render->SetRelativeLocation(Position);
    Render->SetRelativeRotation(Rotation);
    Render->SetText(FText::FromString(Text));
    Render->SetHorizontalAlignment(EHTA_Center);
    Render->SetWorldSize(Size);
    Render->SetTextRenderColor(Color);
    Render->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    AddInstanceComponent(Render);
    Render->RegisterComponent();
}

void AAL60CityWorld::BuildCity()
{
    Box(TEXT("Ground"), FVector(0,0,-60), FVector(19000,8600,100), FLinearColor(0.19f,0.27f,0.24f));
    Box(TEXT("Promenade"), FVector(0,0,-8), FVector(15000,2050,16), FLinearColor(0.64f,0.63f,0.56f));
    for (int Side : {-1,1})
    {
        Box(TEXT("Sidewalk"), FVector(0,Side*1375.f,-3), FVector(15000,670,30), FLinearColor(0.7f,0.7f,0.65f));
        Box(TEXT("Curb"), FVector(0,Side*1045.f,13), FVector(15000,32,34), Stone);
    }
    for (int X=-7200; X<=7200; X+=600)
    {
        Box(TEXT("PavingBand"), FVector(X,0,1), FVector(28,2040,3), FLinearColor(0.36f,0.41f,0.4f), false);
        for (int Y=-750; Y<=750; Y+=500)
            Box(TEXT("PavingInlay"), FVector(X+290,Y,2), FVector(210,210,3), FLinearColor(0.57f,0.6f,0.55f), false, FRotator(0,45,0));
    }
    for (int X : {-8100,8100})
    {
        Box(TEXT("Road"), FVector(X,0,-2), FVector(1000,8000,25), FLinearColor(0.085f,0.12f,0.15f));
        for (int Y=-3200; Y<=3200; Y+=650)
            Box(TEXT("RoadLine"), FVector(X,Y,12), FVector(18,290,2), FLinearColor(0.82f,0.82f,0.74f), false);
        for (int Y=-650; Y<=650; Y+=220)
            Box(TEXT("Crosswalk"), FVector(X,Y,14), FVector(880,95,3), FLinearColor(0.92f,0.88f,0.72f), false);
    }
    // Collision keeps the first slice finite while its skyline extends beyond the playable street.
    Box(TEXT("Boundary"), FVector(0,-4050,240), FVector(19000,60,500), Navy);
    Box(TEXT("Boundary"), FVector(0,4050,240), FVector(19000,60,500), Navy);
    Box(TEXT("Boundary"), FVector(-9450,0,240), FVector(60,8200,500), Navy);
    Box(TEXT("Boundary"), FVector(9450,0,240), FVector(60,8200,500), Navy);

    const TArray<FLinearColor> Facades = {
        FLinearColor(0.68f,0.56f,0.4f), FLinearColor(0.38f,0.5f,0.53f),
        FLinearColor(0.68f,0.67f,0.58f), FLinearColor(0.52f,0.4f,0.33f)
    };
    for (int Side : {-1,1})
    {
        for (int I=0; I<9; ++I)
        {
            const float X=-6500.f+I*1620.f;
            const float Height=620.f+(I%3)*190.f;
            Box(FString::Printf(TEXT("Facade%d"),I%4), FVector(X,Side*2360.f,Height/2), FVector(1460,1280,Height), Facades[I%4]);
            Box(TEXT("RoofCornice"), FVector(X,Side*2360.f,Height+22), FVector(1510,1330,45), FLinearColor(0.79f,0.76f,0.65f));
            Box(TEXT("StoreBase"), FVector(X,Side*1695.f,155), FVector(1460,42,310), Navy);
            for (int Window=0; Window<5; ++Window)
            {
                const float WX=X-550+Window*275;
                Box(TEXT("ShopGlass"), FVector(WX,Side*1668.f,150), FVector(215,8,220), FLinearColor(0.06f,0.24f,0.31f), false);
                Box(TEXT("ShopMullion"), FVector(WX+100,Side*1658.f,150), FVector(8,12,224), FLinearColor(0.3f,0.48f,0.47f), false);
                for (int Floor=0; Floor<(I%3)+1; ++Floor)
                    Box(TEXT("UpperWindow"), FVector(WX,Side*1707.f,425+Floor*190), FVector(135,12,122), FLinearColor(0.09f,0.2f,0.27f), false);
            }
            Box(I%2?TEXT("AwningTeal"):TEXT("AwningYellow"), FVector(X,Side*1510.f,305), FVector(1380,360,35), I%2 ? Teal : Yellow, false);
            if (I%2 == 0)
                for (int Stripe=0; Stripe<9; ++Stripe)
                    Box(TEXT("AwningStripe"), FVector(X-610+Stripe*150,Side*1510.f,325), FVector(45,365,3), FLinearColor(0.9f,0.84f,0.64f), false);
            const TArray<FString> Signs = {TEXT("ART STUDIO"),TEXT("КОФЕ • DEMO"),TEXT("КНИГИ"),TEXT("ГОРОДСКАЯ ГАЛЕРЕЯ")};
            Label(Signs[I%4], FVector(X,Side*1470.f,385), FRotator(0,Side==-1?90:-90,0),52);
        }
    }
    // A stylised department-store landmark, not a licensed building survey or brand partnership.
    Box(TEXT("TsumPodium"), FVector(400,2800,360), FVector(2200,1500,720), FLinearColor(0.49f,0.51f,0.49f));
    for (int I=0; I<13; ++I)
        Box(TEXT("TsumFins"), FVector(-570+I*165,1990,490), FVector(65,95,630), FLinearColor(0.78f,0.72f,0.56f));
    Label(TEXT("ЦУМ"), FVector(400,1920,895), FRotator(0,-90,0),170);
    Label(TEXT("АРБАТ"), FVector(-6920,0,520), FRotator(0,0,0),155);
    Box(TEXT("EntryPost"), FVector(-7010,-610,260), FVector(80,80,520), Navy);
    Box(TEXT("EntryPost"), FVector(-7010,610,260), FVector(80,80,520), Navy);
    Box(TEXT("EntryLintel"), FVector(-7010,0,530), FVector(85,1350,110), Navy);

    for (int X=-6200; X<=6800; X+=1300)
    {
        for (int Side : {-1,1})
        {
            if (X>2500 && X<5600 && Side==-1) continue;
            const FVector P(X,Side*1220.f,0);
            Box(TEXT("Planter"), P+FVector(0,0,42), FVector(210,210,84), Stone);
            Shape(TEXT("TreeTrunk"), CylinderPath, P+FVector(0,0,210), FVector(45,45,350), FLinearColor(0.2f,0.13f,0.075f),true,FRotator::ZeroRotator);
            Shape(TEXT("TreeCrown"), SpherePath, P+FVector(0,0,495), FVector(420,390,440), FLinearColor(0.095f,0.3f,0.2f),false,FRotator::ZeroRotator);
            Shape(TEXT("TreeHighlight"), SpherePath, P+FVector(35,-50,605), FVector(270,285,240), FLinearColor(0.18f,0.42f,0.23f),false,FRotator::ZeroRotator);
            Box(TEXT("BenchSeat"), P+FVector(390,0,55), FVector(240,62,18), FLinearColor(0.38f,0.22f,0.1f));
            Box(TEXT("BenchBack"), P+FVector(390,Side*27.f,95), FVector(240,12,70), FLinearColor(0.38f,0.22f,0.1f));
            for (int Foot : {-1,1}) Box(TEXT("BenchFeet"),P+FVector(390+Foot*85,0,25),FVector(16,52,45),Navy);
            Shape(TEXT("LampPole"), CylinderPath, P+FVector(-340,Side*-330.f,290), FVector(15,15,580),Navy,false,FRotator::ZeroRotator);
            Shape(TEXT("LampBulb"), SpherePath, P+FVector(-340,Side*-330.f,590), FVector(60,60,60),FLinearColor(1.f,0.8f,0.38f),false,FRotator::ZeroRotator,true);
        }
    }
    // Fountain uses opaque geometry so it does not require mobile refraction or particles.
    Shape(TEXT("FountainRim"),CylinderPath,FVector(5800,730,40),FVector(720,720,80),Stone,true,FRotator::ZeroRotator);
    Shape(TEXT("FountainWater"),CylinderPath,FVector(5800,730,84),FVector(640,640,6),Teal,false,FRotator::ZeroRotator);
    Shape(TEXT("FountainCore"),ConePath,FVector(5800,730,210),FVector(140,140,310),FLinearColor(0.44f,0.74f,0.75f),true,FRotator::ZeroRotator);
    for (int I=0; I<4; ++I)
    {
        const FVector P(3300+I*600,-310,40+I%3*30);
        const FVector Size(260,320,80+I%3*60);
        Box(TEXT("ParkourPlatforms"), P,Size,Teal);
        Box(TEXT("ParkourTop"), FVector(P.X,P.Y,Size.Z+2), FVector(265,325,4),Yellow,false);
        ParkourPositions.Add(FVector(P.X,P.Y,Size.Z+92));
    }
    for (int I=0; I<9; ++I)
    {
        const float H=9000.f+(I%3)*2800.f;
        const FVector P(-30000+I*7600,27000+(I%2)*4000,H*.36f);
        Shape(TEXT("MountainBase"),ConePath,P,FVector(17000,15000,H),FLinearColor(0.16f,0.31f,0.43f),false,FRotator(0,I*27,0));
        Shape(TEXT("MountainSnow"),ConePath,P+FVector(0,0,H*.28f),FVector(5900,5200,H*.42f),FLinearColor(0.79f,0.89f,0.91f),false,FRotator(0,I*27,0));
    }
}

void AAL60CityWorld::BuildLighting()
{
    Shape(TEXT("Sky"),SpherePath,FVector::ZeroVector,FVector(140000),FLinearColor(0.24f,0.48f,0.64f),false,FRotator::ZeroRotator,true);
    ADirectionalLight* Sun = GetWorld()->SpawnActor<ADirectionalLight>();
    if (Sun)
    {
        Sun->SetActorRotation(FRotator(-38,-28,0));
        UDirectionalLightComponent* Light=Cast<UDirectionalLightComponent>(Sun->GetLightComponent());
        Light->SetMobility(EComponentMobility::Movable);
        Light->SetIntensity(3.8f);
        Light->SetLightColor(FLinearColor(1.f,0.87f,0.7f));
        Light->DynamicShadowDistanceMovableLight=7500.f;
        Light->DynamicShadowCascades=2;
    }
    ASkyLight* Sky = GetWorld()->SpawnActor<ASkyLight>();
    if (Sky)
    {
        Sky->GetLightComponent()->SetMobility(EComponentMobility::Movable);
        Sky->GetLightComponent()->SetIntensity(0.9f);
        Sky->GetLightComponent()->SetLightColor(FLinearColor(0.6f,0.77f,1.f));
        Sky->GetLightComponent()->RecaptureSky();
    }
}

AAL60Citizen* AAL60CityWorld::AddCitizen(FName Id, const FString& Name, FVector Position, FVector PatrolEnd, FLinearColor Jacket)
{
    const FTransform Transform(FRotator::ZeroRotator, Position);
    AAL60Citizen* Citizen=GetWorld()->SpawnActorDeferred<AAL60Citizen>(AAL60Citizen::StaticClass(),Transform,this,nullptr,ESpawnActorCollisionHandlingMethod::AlwaysSpawn);
    if (Citizen)
    {
        Citizen->Configure(Id,Name,PatrolEnd,Jacket);
        UGameplayStatics::FinishSpawningActor(Citizen,Transform);
        Citizens.Add(Citizen);
    }
    return Citizen;
}

void AAL60CityWorld::BuildActivities()
{
    for (int I=0; I<2; ++I)
    {
        const FTransform CarTransform(FRotator(0,I?180:0,0),I?FVector(6500,-700,85):FVector(-6050,450,85));
        AAL60VehiclePawn* Car=GetWorld()->SpawnActorDeferred<AAL60VehiclePawn>(AAL60VehiclePawn::StaticClass(),CarTransform,this,nullptr,ESpawnActorCollisionHandlingMethod::AlwaysSpawn);
        if (Car)
        {
            Car->BodyColor=I?FLinearColor(.035f,.35f,.47f):Yellow;
            UGameplayStatics::FinishSpawningActor(Car,CarTransform);
        }
    }
    AddCitizen(TEXT("delivery"),TEXT("Аружан · городской курьер"),FVector(-5750,-700,96),FVector::ZeroVector,Yellow);
    AddCitizen(TEXT("recipient"),TEXT("Тимур · книжная лавка"),FVector(5100,-1080,96),FVector::ZeroVector,Teal);
    AddCitizen(TEXT("find"),TEXT("Марат · художник"),FVector(-2350,800,96),FVector::ZeroVector,FLinearColor(0.56f,0.21f,0.13f));
    AddCitizen(TEXT("parkour"),TEXT("Дана · тренер"),FVector(2800,-740,96),FVector::ZeroVector,FLinearColor(0.14f,0.22f,0.48f));
    for (int I=0; I<8; ++I)
    {
        const FVector P(-5000+I*1330,(I%2?1:-1)*630,96);
        AddCitizen(NAME_None,TEXT("Житель · NPC"),P,P+FVector(700,I%2?130:-130,0),FLinearColor(0.1f+I*.055f,0.25f,0.3f));
    }
    Landmarks={
        {TEXT("gate"),TEXT("Вход на Арбат"),FVector(-6700,0,0)},
        {TEXT("gallery"),TEXT("Городская галерея"),FVector(-2350,950,0)},
        {TEXT("tsum"),TEXT("Площадь у ЦУМа"),FVector(350,1300,0)},
        {TEXT("books"),TEXT("Книжная аллея"),FVector(5100,-1100,0)},
        {TEXT("fountain"),TEXT("Фонтан и горы"),FVector(5800,450,0)}
    };
    SearchPositions={FVector(-1300,-930,45),FVector(900,930,45),FVector(3950,-1080,45)};
    for (const FVector& Position : SearchPositions)
    {
        UStaticMeshComponent* Item=NewObject<UStaticMeshComponent>(this);
        Item->SetupAttachment(RootComponent);
        Item->SetStaticMesh(LoadObject<UStaticMesh>(nullptr,CubePath));
        Item->SetRelativeLocation(Position);
        Item->SetRelativeScale3D(FVector(.5f,.38f,.035f));
        Item->SetRelativeRotation(FRotator(0,25,0));
        Item->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        UMaterialInstanceDynamic* Material=UMaterialInstanceDynamic::Create(UnlitMaterial,this);
        Material->SetVectorParameterValue(TEXT("Tint"),Yellow);
        Item->SetMaterial(0,Material);
        AddInstanceComponent(Item); Item->RegisterComponent(); Item->SetVisibility(false);
        SearchObjects.Add(Item);
    }
    // The world matches the dedicated server mission's metre coordinates × 100.
    const TArray<FVector2D> Targets={FVector2D(12,0),FVector2D(26,5),FVector2D(40,0),FVector2D(54,-5),FVector2D(68,0)};
    for (int I=0; I<Targets.Num(); ++I)
    {
        const FVector P=RouteOrigin+FVector(Targets[I].X*100,Targets[I].Y*100,95);
        AAL60CheckpointActor* Gate=GetWorld()->SpawnActor<AAL60CheckpointActor>(P,FRotator::ZeroRotator);
        if (Gate) { Gate->Sequence=I+1; BrandGates.Add(Gate); }
    }
    AAL60MissionStartActor* Start=GetWorld()->SpawnActor<AAL60MissionStartActor>(RouteOrigin+FVector(0,0,15),FRotator::ZeroRotator);
    if (Start) Start->MissionId=TEXT("m_arbat_60_checkpoint_run");
    Label(TEXT("ALMATY 60 · DEMO"),RouteOrigin+FVector(-130,0,300),FRotator::ZeroRotator,70);
    Label(TEXT("60 секунд · серверное испытание"),RouteOrigin+FVector(-130,0,220),FRotator::ZeroRotator,30,FColor(110,232,228));
}

FString AAL60CityWorld::GetInteractionPrompt(const FVector& Position) const
{
    if (IsDialogueOpen()) return PendingQuest.IsNone()?TEXT("E · Закрыть разговор"):TEXT("E · Принять задание");
    for (TActorIterator<AAL60VehiclePawn> It(GetWorld()); It; ++It)
        if (!It->GetDriver() && FVector::DistSquared2D(Position,It->GetActorLocation())<=FMath::Square(330.f))
            return It->GetStatusMessage().IsEmpty()?TEXT("E · Сесть в автомобиль AL60"):It->GetStatusMessage();
    for (const AAL60Citizen* Citizen : Citizens)
        if (Citizen && !Citizen->CitizenId.IsNone() && FVector::DistSquared2D(Position,Citizen->GetActorLocation())<FMath::Square(310.f))
            return TEXT("E · Поговорить: ")+Citizen->DisplayName;
    return FString();
}

void AAL60CityWorld::Interact(AAL60PlayerCharacter* Player)
{
    if (!Player) return;
    if (IsDialogueOpen())
    {
        const FName Accepted=PendingQuest;
        DialogueText.Empty(); DialogueSpeaker.Empty(); PendingQuest=NAME_None;
        if (!Accepted.IsNone()) BeginQuest(Accepted,Player);
        return;
    }
    for (AAL60Citizen* Citizen : Citizens)
    {
        if (!Citizen || Citizen->CitizenId.IsNone() || FVector::DistSquared2D(Player->GetActorLocation(),Citizen->GetActorLocation())>FMath::Square(310.f)) continue;
        DialogueSpeaker=Citizen->DisplayName;
        if (Citizen->CitizenId==TEXT("recipient") && ActiveQuest==TEXT("delivery"))
        {
            CompleteQuest(Player);
            DialogueText=TEXT("Книги приехали! Спасибо. На Арбате каждый день появляются новые истории.");
        }
        else if (Citizen->CitizenId==TEXT("find") && ActiveQuest==TEXT("find") && FoundItems.Num()==3)
        {
            CompleteQuest(Player);
            DialogueText=TEXT("Все три эскиза на месте! Посмотри на горы: следующий рисунок будет о них.");
        }
        else if (!ActiveQuest.IsNone()) DialogueText=TEXT("Сначала закончи начатое задание. Нужная точка отмечена на миникарте.");
        else if (Citizen->CitizenId==TEXT("delivery"))
        {
            DialogueText=TEXT("Привет! Доставишь коробку с книгами Тимуру в лавку на другом конце аллеи? Можно не спешить: по пути загляни к художникам.");
            PendingQuest=TEXT("delivery");
        }
        else if (Citizen->CitizenId==TEXT("find"))
        {
            DialogueText=TEXT("Ветер унёс три моих эскиза. Поищи жёлтые листы у витрин и деревьев, потом возвращайся ко мне.");
            PendingQuest=TEXT("find");
        }
        else if (Citizen->CitizenId==TEXT("parkour"))
        {
            DialogueText=TEXT("Готов к разминке? Приземлись по очереди на четыре бирюзовые платформы. На трассу даю 80 секунд. Прыжок — пробел или кнопка справа.");
            PendingQuest=TEXT("parkour");
        }
        else DialogueText=TEXT("Добро пожаловать в книжную лавку. Аружан у входа как раз собирала для нас посылку.");
        break;
    }
}

void AAL60CityWorld::BeginQuest(FName Id,AAL60PlayerCharacter* Player)
{
    ActiveQuest=Id; QuestStep=0; FoundItems.Empty();
    Player->SetCarryingParcel(Id==TEXT("delivery"));
    for (UStaticMeshComponent* Item : SearchObjects) Item->SetVisibility(Id==TEXT("find"));
    if (Id==TEXT("parkour")) ParkourDeadline=FPlatformTime::Seconds()+80;
    Notify(TEXT("Задание принято: ")+GetQuestTitle());
}

void AAL60CityWorld::CompleteQuest(AAL60PlayerCharacter* Player)
{
    const int32 Reward=ActiveQuest==TEXT("delivery")?150:ActiveQuest==TEXT("find")?200:240;
    if (Save && !Save->CompletedQuests.Contains(ActiveQuest))
    {
        Save->CompletedQuests.Add(ActiveQuest); Save->Xp+=Reward; Save->Coins+=Reward/3; SaveProgress();
        Notify(FString::Printf(TEXT("Задание выполнено! +%d XP · +%d городских монет"),Reward,Reward/3));
    }
    else Notify(TEXT("Маршрут пройден ещё раз. Награда за первое прохождение уже получена."));
    ActiveQuest=NAME_None; QuestStep=0; Player->SetCarryingParcel(false);
    for (UStaticMeshComponent* Item : SearchObjects) Item->SetVisibility(false);
}

FString AAL60CityWorld::GetQuestTitle() const
{
    if (ActiveQuest==TEXT("delivery")) return TEXT("Истории в коробке");
    if (ActiveQuest==TEXT("find")) return TEXT("Три эскиза Арбата");
    if (ActiveQuest==TEXT("parkour")) return TEXT("Движение города");
    return TEXT("Твой Арбат");
}

FString AAL60CityWorld::GetQuestObjective() const
{
    if (ActiveQuest==TEXT("delivery")) return TEXT("Доставь книги Тимуру · поговори у лавки");
    if (ActiveQuest==TEXT("find")) return FoundItems.Num()==3?TEXT("Верни эскизы Марату"):FString::Printf(TEXT("Найди эскизы у витрин · %d / 3"),FoundItems.Num());
    if (ActiveQuest==TEXT("parkour")) return FString::Printf(TEXT("Приземлись на платформу %d / 4 · %d сек"),FMath::Min(QuestStep+1,4),FMath::Max(0,FMath::CeilToInt32(ParkourDeadline-FPlatformTime::Seconds())));
    return FString::Printf(TEXT("Открой 5 мест · %d / 5. Познакомься с жителями."),GetDiscoveredCount());
}

FVector AAL60CityWorld::GetObjectiveLocation() const
{
    if (ActiveQuest==TEXT("delivery")) return FVector(5100,-1080,96);
    if (ActiveQuest==TEXT("find"))
    {
        for (int I=0; I<SearchPositions.Num(); ++I) if (!FoundItems.Contains(I)) return SearchPositions[I];
        return FVector(-2350,800,96);
    }
    if (ActiveQuest==TEXT("parkour") && ParkourPositions.IsValidIndex(QuestStep)) return ParkourPositions[QuestStep];
    for (const FAL60Landmark& Landmark : Landmarks) if (Save && !Save->Discovered.Contains(Landmark.Id)) return Landmark.Position;
    return FVector(-5750,-700,96);
}

void AAL60CityWorld::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    APawn* ControlledPawn=UGameplayStatics::GetPlayerPawn(this,0);
    AAL60VehiclePawn* Vehicle=Cast<AAL60VehiclePawn>(ControlledPawn);
    AAL60PlayerCharacter* Player=Vehicle?Vehicle->GetDriver():Cast<AAL60PlayerCharacter>(ControlledPawn);
    if (!Player) return;
    const FVector Position=ControlledPawn->GetActorLocation();
    if (FPlatformTime::Seconds()>ToastUntil) ToastText.Empty();
    for (const FAL60Landmark& Landmark : Landmarks)
        if (Save && !Save->Discovered.Contains(Landmark.Id) && FVector::DistSquared2D(Position,Landmark.Position)<FMath::Square(440.f))
        {
            Save->Discovered.Add(Landmark.Id); Save->Xp+=35; Save->Coins+=10; SaveProgress();
            Notify(TEXT("Открыто: ")+Landmark.Name+TEXT(" · +35 XP"));
        }
    if (ActiveQuest==TEXT("find") && !Vehicle)
        for (int I=0; I<SearchPositions.Num(); ++I)
            if (!FoundItems.Contains(I) && FVector::DistSquared2D(Position,SearchPositions[I])<FMath::Square(145.f))
            {
                FoundItems.Add(I); SearchObjects[I]->SetVisibility(false);
                Notify(FString::Printf(TEXT("Эскиз найден · %d / 3"),FoundItems.Num()));
            }
    if (ActiveQuest==TEXT("parkour"))
    {
        if (FPlatformTime::Seconds()>=ParkourDeadline)
        {
            ActiveQuest=NAME_None; Notify(TEXT("Время тренировки вышло. Дана предложит попробовать снова."));
        }
        else if (!Vehicle && ParkourPositions.IsValidIndex(QuestStep) && !Player->GetCharacterMovement()->IsFalling()
            && FVector::DistSquared2D(Position,ParkourPositions[QuestStep])<FMath::Square(130.f)
            && FMath::Abs(Position.Z-ParkourPositions[QuestStep].Z)<35.f)
        {
            ++QuestStep; Notify(FString::Printf(TEXT("Платформа %d / 4"),QuestStep));
            if (QuestStep==ParkourPositions.Num()) CompleteQuest(Player);
        }
    }
    if (UGameInstance* GI=GetGameInstance())
        if (UAL60MissionManager* Manager=GI->GetSubsystem<UAL60MissionManager>())
        {
            const FAL60MissionState MissionState=Manager->GetState();
            for (AAL60CheckpointActor* Gate : BrandGates)
                Gate->UpdateVisualState(Gate->Sequence<=MissionState.CompletedCheckpoints,Gate->Sequence==MissionState.CompletedCheckpoints+1 && MissionState.Status==EAL60MissionStatus::Active);
        }
}

void AAL60CityWorld::Notify(const FString& Text) { ToastText=Text; ToastUntil=FPlatformTime::Seconds()+5; }
void AAL60CityWorld::SaveProgress() { if (Save) UGameplayStatics::SaveGameToSlot(Save,TEXT("AL60_City_Demo_v1"),0); }
int32 AAL60CityWorld::GetXp() const { return Save?Save->Xp:0; }
int32 AAL60CityWorld::GetCoins() const { return Save?Save->Coins:0; }
int32 AAL60CityWorld::GetDiscoveredCount() const { return Save?Save->Discovered.Num():0; }
int32 AAL60CityWorld::GetCompletedQuestCount() const { return Save?Save->CompletedQuests.Num():0; }
