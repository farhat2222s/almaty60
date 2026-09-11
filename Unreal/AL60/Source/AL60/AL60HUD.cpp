#include "AL60HUD.h"
#include "AL60CityWorld.h"
#include "AL60MissionManager.h"
#include "AL60VehiclePawn.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"

namespace
{
    const FLinearColor Panel(.012f,.03f,.058f,.91f);
    const FLinearColor Yellow(1.f,.76f,.08f);
    const FLinearColor Pale(.79f,.87f,.91f);
    const FLinearColor Teal(.25f,.88f,.84f);
}
void AAL60HUD::TextLine(const FString& Text,float X,float Y,float Size,FLinearColor Color)
{
    DrawText(Text,Color,X,Y,GEngine->GetMediumFont(),Size*UiScale,false);
}
float AAL60HUD::Paragraph(const FString& Text,float X,float Y,float Width,float Size,FLinearColor Color)
{
    TArray<FString> Words; Text.ParseIntoArray(Words,TEXT(" "),true);
    FString Line;
    for (const FString& Word : Words)
    {
        const FString Candidate=Line.IsEmpty()?Word:Line+TEXT(" ")+Word;
        float W,H; GetTextSize(Candidate,W,H,GEngine->GetMediumFont(),Size*UiScale);
        if (W>Width && !Line.IsEmpty()) { TextLine(Line,X,Y,Size,Color); Y+=24*UiScale*Size; Line=Word; }
        else Line=Candidate;
    }
    if (!Line.IsEmpty()) { TextLine(Line,X,Y,Size,Color); Y+=24*UiScale*Size; }
    return Y;
}
void AAL60HUD::DrawHUD()
{
    Super::DrawHUD();
    if (!Canvas || !GEngine) return;
    UiScale=FMath::Clamp(Canvas->ClipX/1600.f,.58f,1.2f);
    const float S=UiScale,W=Canvas->ClipX,H=Canvas->ClipY;
    AAL60CityWorld* City=nullptr;
    for (TActorIterator<AAL60CityWorld> It(GetWorld()); It; ++It) { City=*It; break; }
    UAL60MissionManager* Manager=GetGameInstance()?GetGameInstance()->GetSubsystem<UAL60MissionManager>():nullptr;
    const APawn* Player=PlayerOwner?PlayerOwner->GetPawn():nullptr;
    const AAL60VehiclePawn* Vehicle=Cast<AAL60VehiclePawn>(Player);
    if (!City || !Player) return;
    DrawRect(Panel,24*S,24*S,365*S,112*S);
    TextLine(TEXT("ALMATY"),42*S,34*S,1.45f,FLinearColor::White);
    TextLine(TEXT("60"),204*S,30*S,1.8f,Yellow);
    TextLine(TEXT("АРБАТ · АЛМАТЫ"),43*S,73*S,.72f,Teal);
    TextLine(FString::Printf(TEXT("Ур. %d    %d XP    %d монет"),City->GetXp()/300+1,City->GetXp(),City->GetCoins()),43*S,102*S,.68f,Pale);
    DrawRect(Panel,24*S,152*S,365*S,153*S);
    TextLine(City->GetQuestTitle(),42*S,168*S,.92f,Yellow);
    Paragraph(City->GetQuestObjective(),42*S,203*S,325*S,.75f,Pale);
    TextLine(TEXT("Городской прогресс · на устройстве"),42*S,280*S,.52f,Pale);
    const FString Prompt=Vehicle?(Vehicle->GetStatusMessage().IsEmpty()?TEXT("E · Выйти после остановки"):Vehicle->GetStatusMessage()):City->GetInteractionPrompt(Player->GetActorLocation());
    if (!Prompt.IsEmpty())
    {
        DrawRect(Panel,W*.5f-245*S,H-95*S,490*S,50*S);
        Paragraph(Prompt,W*.5f-225*S,H-84*S,450*S,.77f,Yellow);
    }
    // Mini-map uses the same native world coordinates, rather than implying real GPS attendance.
    const float MX=W-268*S,MY=24*S;
    DrawRect(Panel,MX,MY,244*S,195*S);
    TextLine(TEXT("АРБАТ · ВИРТУАЛЬНЫЙ МИР"),MX+13*S,MY+11*S,.52f,Pale);
    DrawRect(FLinearColor(.12f,.21f,.27f),MX+16*S,MY+65*S,212*S,60*S);
    auto Map=[&](FVector P) { return FVector2D(MX+(16+FMath::Clamp((P.X+9500)/19000,0.0,1.0)*212)*S,MY+(40+FMath::Clamp((P.Y+4200)/8400,0.0,1.0)*122)*S); };
    for (const FAL60Landmark& Landmark : City->GetLandmarks()) { const FVector2D P=Map(Landmark.Position); DrawRect(Teal,P.X-3*S,P.Y-3*S,6*S,6*S); }
    FVector Objective=City->GetObjectiveLocation();
    if (Manager && Manager->IsServerDriving()) Objective=Manager->GetNextCheckpointWorldPosition();
    const FVector2D Goal=Map(Objective); DrawRect(Yellow,Goal.X-5*S,Goal.Y-5*S,10*S,10*S);
    const FVector2D P=Map(Player->GetActorLocation()); DrawRect(FLinearColor::White,P.X-4*S,P.Y-4*S,8*S,8*S);
    TextLine(FString::Printf(TEXT("До цели: %.0f м"),FVector::Dist2D(Player->GetActorLocation(),Objective)/100.f),MX+14*S,MY+169*S,.63f,Yellow);
    if (Vehicle)
    {
        DrawRect(Panel,MX,MY+208*S,244*S,65*S);
        TextLine(FString::Printf(TEXT("%s   %.0f км/ч"),Vehicle->IsReversing()?TEXT("R"):TEXT("D"),Vehicle->GetSpeedKph()),MX+16*S,MY+224*S,1.12f,Yellow);
    }
    if (Manager)
    {
        const FAL60MissionState& State=Manager->GetState();
        const bool bShow=State.Status!=EAL60MissionStatus::Idle;
        if (bShow)
        {
            const float X=W*.5f-195*S;
            DrawRect(Panel,X,24*S,390*S,125*S);
            TextLine(TEXT("BRAND CHALLENGE · DEMO"),X+17*S,36*S,.58f,Teal);
            if (State.Status==EAL60MissionStatus::Active)
            {
                TextLine(FString::Printf(TEXT("%02d"),FMath::CeilToInt(Manager->GetRemainingSeconds())),X+17*S,61*S,2.1f,Yellow);
                TextLine(FString::Printf(TEXT("ТОЧКИ %d / %d"),State.CompletedCheckpoints,State.TotalCheckpoints),X+125*S,80*S,.83f,FLinearColor::White);
                TextLine(TEXT("Движение и результат проверяет сервер"),X+17*S,123*S,.49f,Pale);
            }
            else if (State.Status==EAL60MissionStatus::Won)
            {
                TextLine(TEXT("ПОБЕДА ПОДТВЕРЖДЕНА"),X+17*S,66*S,.88f,Yellow);
                TextLine(State.RewardCode.IsEmpty()?TEXT("Награда сохранена в серверном профиле"):State.RewardCode,X+17*S,100*S,.61f,Teal);
            }
            else if (State.Status==EAL60MissionStatus::Failed)
            { TextLine(TEXT("ПОПРОБУЙ ЕЩЁ РАЗ"),X+17*S,69*S,.93f,Yellow); TextLine(TEXT("Вернись к стартовой площадке"),X+17*S,110*S,.57f,Pale); }
            else TextLine(State.Status==EAL60MissionStatus::Starting?TEXT("ПОДКЛЮЧАЕМ ПОПЫТКУ..."):TEXT("ПРОВЕРЯЕМ РЕЗУЛЬТАТ..."),X+17*S,74*S,.8f,Yellow);
        }
        Paragraph(Manager->GetConnectionMessage(),26*S,H-37*S,W-52*S,.48f,Pale);
    }
    if (!City->GetToast().IsEmpty())
    {
        DrawRect(Panel,W*.5f-325*S,174*S,650*S,58*S);
        Paragraph(City->GetToast(),W*.5f-307*S,188*S,614*S,.72f,Yellow);
    }
    if (City->IsDialogueOpen())
    {
        const float X=W*.5f-360*S,Y=H-283*S;
        DrawRect(Panel,X,Y,720*S,155*S);
        TextLine(City->GetDialogueSpeaker(),X+21*S,Y+16*S,.88f,Yellow);
        Paragraph(City->GetDialogueText(),X+21*S,Y+51*S,676*S,.72f,FLinearColor::White);
    }
#if !(PLATFORM_IOS || PLATFORM_ANDROID)
    TextLine(Vehicle?TEXT("W/S газ, торможение и задний ход  ·  A/D руль  ·  Пробел тормоз  ·  Мышь камера  ·  E выйти"):TEXT("WASD движение  ·  Мышь камера  ·  Пробел прыжок  ·  Shift бег  ·  E разговор / автомобиль  ·  L вход"),26*S,H-65*S,.53f,Pale);
#endif
}
