#include "AL60MissionManager.h"
#include "Dom/JsonObject.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonSerializer.h"
#include "HAL/PlatformTime.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

void UAL60MissionManager::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    GConfig->GetString(TEXT("AL60"), TEXT("BackendBaseUrl"), BackendBaseUrl, GGameIni);
    if (BackendBaseUrl.IsEmpty()) BackendBaseUrl=TEXT("http://127.0.0.1:3080");
    FParse::Value(FCommandLine::Get(), TEXT("AL60Backend="), BackendBaseUrl);
    BackendBaseUrl.RemoveFromEnd(TEXT("/"));
    ConnectionMessage=TEXT("Город доступен без входа. Серверные испытания — после подключения.");
    TickHandle=FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this,&UAL60MissionManager::TickMission),0.1f);
}

void UAL60MissionManager::Deinitialize()
{
    ++RequestGeneration;
    FTSTicker::GetCoreTicker().RemoveTicker(TickHandle);
    TickHandle.Reset();
    AccessToken.Empty();
    Super::Deinitialize();
}

void UAL60MissionManager::SendJsonRequest(const FString& Verb,const FString& Path,const TSharedPtr<FJsonObject>& Payload,
    TFunction<void(bool,int32,TSharedPtr<FJsonObject>)> Callback,const FString& IdempotencyKey)
{
    const uint32 Generation=RequestGeneration;
    TSharedRef<IHttpRequest,ESPMode::ThreadSafe> Request=FHttpModule::Get().CreateRequest();
    Request->SetURL(BackendBaseUrl+Path);
    Request->SetVerb(Verb);
    Request->SetHeader(TEXT("Content-Type"),TEXT("application/json"));
    Request->SetHeader(TEXT("Accept"),TEXT("application/json"));
    Request->SetTimeout(10.f);
    if (!AccessToken.IsEmpty()) Request->SetHeader(TEXT("Authorization"),TEXT("Bearer ")+AccessToken);
    if (!IdempotencyKey.IsEmpty()) Request->SetHeader(TEXT("Idempotency-Key"),IdempotencyKey);
    if (Payload)
    {
        FString Body;
        TSharedRef<TJsonWriter<>> Writer=TJsonWriterFactory<>::Create(&Body);
        FJsonSerializer::Serialize(Payload.ToSharedRef(),Writer);
        Request->SetContentAsString(Body);
    }
    Request->OnProcessRequestComplete().BindWeakLambda(this,[this,Generation,Callback](FHttpRequestPtr Req,FHttpResponsePtr Resp,bool bTransportOk)
    {
        if (Generation!=RequestGeneration) return;
        const int32 Code=Resp?Resp->GetResponseCode():0;
        if (Code==401) AccessToken.Empty();
        TSharedPtr<FJsonObject> Json;
        if (Resp)
        {
            TSharedRef<TJsonReader<>> Reader=TJsonReaderFactory<>::Create(Resp->GetContentAsString());
            FJsonSerializer::Deserialize(Reader,Json);
        }
        Callback(bTransportOk && Code>=200 && Code<300 && Json.IsValid(),Code,Json);
    });
    if (!Request->ProcessRequest()) Callback(false,0,nullptr);
}

void UAL60MissionManager::Authenticate(const FString& Email,const FString& Password,const FString& Name,bool bRegister)
{
    if (bAuthPending || State.Status==EAL60MissionStatus::Active || State.Status==EAL60MissionStatus::Verifying) return;
    if (Email.IsEmpty() || Password.IsEmpty()) { ConnectionMessage=TEXT("Введите почту и пароль."); return; }
    bAuthPending=true;
    ConnectionMessage=TEXT("Подключение к серверу...");
    TSharedPtr<FJsonObject> Payload=MakeShared<FJsonObject>();
    Payload->SetStringField(TEXT("email"),Email.TrimStartAndEnd());
    Payload->SetStringField(TEXT("password"),Password);
    if (bRegister) Payload->SetStringField(TEXT("name"),Name.IsEmpty()?TEXT("Гость Арбата"):Name);
    SendJsonRequest(TEXT("POST"),bRegister?TEXT("/api/auth/register"):TEXT("/api/auth/login"),Payload,
        [this](bool Ok,int32 Code,TSharedPtr<FJsonObject> Json)
    {
        bAuthPending=false;
        if (!Ok)
        {
            ConnectionMessage=Code==0?TEXT("Сервер недоступен. Городские задания продолжают работать."):TEXT("Вход не выполнен. Проверьте почту и пароль (не менее 12 символов для регистрации).");
            return;
        }
        if (!Json->TryGetStringField(TEXT("token"),AccessToken) || AccessToken.IsEmpty())
        { ConnectionMessage=TEXT("Сервер не вернул токен входа."); return; }
        const TSharedPtr<FJsonObject>* User;
        if (Json->TryGetObjectField(TEXT("user"),User)) (*User)->TryGetStringField(TEXT("name"),PlayerName);
        const TSharedPtr<FJsonObject>* Profile;
        if (Json->TryGetObjectField(TEXT("profile"),Profile))
        {
            double Xp=0,Coins=0;
            (*Profile)->TryGetNumberField(TEXT("xp"),Xp); (*Profile)->TryGetNumberField(TEXT("coins"),Coins);
            ServerXp=static_cast<int32>(Xp); ServerCoins=static_cast<int32>(Coins);
        }
        ConnectionMessage=TEXT("Подключено: ")+PlayerName+TEXT(" · демонстрационные награды");
        SendJsonRequest(TEXT("GET"),TEXT("/api/me"),nullptr,[this](bool ProfileOk,int32 ProfileCode,TSharedPtr<FJsonObject> Me)
        {
            const TSharedPtr<FJsonObject>* Active;
            if (ProfileOk && Me->TryGetObjectField(TEXT("activeAttempt"),Active) && Active->IsValid())
            {
                PendingMissionId.Empty(); State=FAL60MissionState(); ApplyAttempt(*Active);
            }
            else if (!PendingMissionId.IsEmpty())
            {
                const FString Mission=PendingMissionId; PendingMissionId.Empty(); StartMission(Mission);
            }
        });
    });
}

void UAL60MissionManager::StartMission(const FString& MissionId)
{
    if (State.Status==EAL60MissionStatus::Active || State.Status==EAL60MissionStatus::Starting || bFinishPending) return;
    if (!IsAuthenticated()) { PendingMissionId=MissionId; ConnectionMessage=TEXT("Нажмите L / «Войти», чтобы подключить серверное испытание."); return; }
    ++RequestGeneration;
    bInputPending=false; bSyncPending=false; LastInputSeq=0;
    State=FAL60MissionState(); State.MissionId=MissionId; State.Status=EAL60MissionStatus::Starting;
    PendingMissionId=MissionId;
    PendingStartKey=FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens);
    bStartPending=false; bNeedsSync=false; NextNetworkRetry=0;
    Broadcast(); SendStartRequest();
}

void UAL60MissionManager::SendStartRequest()
{
    if (bStartPending || State.Status!=EAL60MissionStatus::Starting || PendingStartKey.IsEmpty()) return;
    bStartPending=true;
    SendJsonRequest(TEXT("POST"),TEXT("/api/missions/")+State.MissionId+TEXT("/start"),MakeShared<FJsonObject>(),
        [this](bool Ok,int32 Code,TSharedPtr<FJsonObject> Json)
    {
        bStartPending=false;
        if (Ok)
        {
            PendingMissionId.Empty(); PendingStartKey.Empty(); ApplyAttempt(Json);
            // An idempotent replay can contain the original start snapshot. Reconcile before sending input.
            bNeedsSync=true; NextNetworkRetry=0; SyncAttempt(); return;
        }
        if (Code==0 || Code>=500 || Code==429)
        {
            ConnectionMessage=TEXT("Нет подтверждения старта. Повторяем тот же запрос через 2 секунды.");
            NextNetworkRetry=FPlatformTime::Seconds()+2.0; return;
        }
        if (Code==409)
        {
            // A previous session may already own an active attempt; recover its server record.
            SendJsonRequest(TEXT("GET"),TEXT("/api/me"),nullptr,[this](bool MeOk,int32 MeCode,TSharedPtr<FJsonObject> Me)
            {
                const TSharedPtr<FJsonObject>* Active;
                if (MeOk && Me->TryGetObjectField(TEXT("activeAttempt"),Active) && Active->IsValid())
                { PendingMissionId.Empty(); PendingStartKey.Empty(); State=FAL60MissionState(); ApplyAttempt(*Active); }
                else if (MeCode==0 || MeCode>=500)
                { NextNetworkRetry=FPlatformTime::Seconds()+2.0; }
                else FailMission(TEXT("Кампания недоступна или лимит попыток исчерпан."));
            });
            NextNetworkRetry=FPlatformTime::Seconds()+3.0; return;
        }
        FailMission(Code==401?TEXT("Сессия истекла. Войдите снова."):TEXT("Сервер отклонил старт испытания."));
    },PendingStartKey);
}

void UAL60MissionManager::ApplyAttempt(const TSharedPtr<FJsonObject>& Json)
{
    if (!Json) return;
    FString IncomingStatus;
    Json->TryGetStringField(TEXT("status"),IncomingStatus);
    if ((State.Status==EAL60MissionStatus::Won || State.Status==EAL60MissionStatus::Failed) && IncomingStatus==TEXT("active")) return;
    Json->TryGetStringField(TEXT("attemptId"),State.AttemptId);
    Json->TryGetStringField(TEXT("missionId"),State.MissionId);
    double Total=State.TotalCheckpoints,Completed=State.CompletedCheckpoints,Limit=State.TimeLimitSeconds,Remaining=0,Seq=LastInputSeq;
    Json->TryGetNumberField(TEXT("totalCheckpoints"),Total);
    Json->TryGetNumberField(TEXT("completedCheckpoints"),Completed);
    Json->TryGetNumberField(TEXT("timeLimitSeconds"),Limit);
    Json->TryGetNumberField(TEXT("remainingSeconds"),Remaining);
    Json->TryGetNumberField(TEXT("lastInputSeq"),Seq);
    State.TotalCheckpoints=static_cast<int32>(Total); State.CompletedCheckpoints=static_cast<int32>(Completed);
    State.TimeLimitSeconds=static_cast<int32>(Limit); State.ClientRemainingSeconds=FMath::Max(0.f,static_cast<float>(Remaining));
    LastInputSeq=static_cast<int32>(Seq); LocalDeadline=FPlatformTime::Seconds()+State.ClientRemainingSeconds;
    const TSharedPtr<FJsonObject>* Position;
    if (Json->TryGetObjectField(TEXT("position"),Position))
    {
        double X=0,Z=0; (*Position)->TryGetNumberField(TEXT("x"),X); (*Position)->TryGetNumberField(TEXT("z"),Z);
        ServerPosition=FVector2D(X,Z);
    }
    const TArray<TSharedPtr<FJsonValue>>* TargetValues;
    if (Json->TryGetArrayField(TEXT("targets"),TargetValues))
    {
        Targets.Empty();
        for (const TSharedPtr<FJsonValue>& Target : *TargetValues)
        {
            const TSharedPtr<FJsonObject> Object=Target->AsObject();
            if (!Object) continue;
            double X=0,Z=0; Object->TryGetNumberField(TEXT("x"),X); Object->TryGetNumberField(TEXT("z"),Z);
            Targets.Add(FVector2D(X,Z));
        }
    }
    FString Status;
    Json->TryGetStringField(TEXT("status"),Status);
    State.Status=Status==TEXT("won")?EAL60MissionStatus::Won:Status==TEXT("failed")?EAL60MissionStatus::Failed:EAL60MissionStatus::Active;
    const TSharedPtr<FJsonObject>* Reward;
    if (Json->TryGetObjectField(TEXT("reward"),Reward))
    {
        if (!(*Reward)->TryGetStringField(TEXT("code"),State.RewardCode))
            if (!(*Reward)->TryGetStringField(TEXT("redemptionCode"),State.RewardCode)) (*Reward)->TryGetStringField(TEXT("redemption_code"),State.RewardCode);
        if (!(*Reward)->TryGetStringField(TEXT("expiresAt"),State.RewardExpiresAt)) (*Reward)->TryGetStringField(TEXT("expires_at"),State.RewardExpiresAt);
    }
    double RewardXp=State.RewardXp,RewardCoins=State.RewardCoins;
    Json->TryGetNumberField(TEXT("rewardXp"),RewardXp); Json->TryGetNumberField(TEXT("rewardCoins"),RewardCoins);
    State.RewardXp=static_cast<int32>(RewardXp); State.RewardCoins=static_cast<int32>(RewardCoins);
    const TSharedPtr<FJsonObject>* Profile;
    if (Json->TryGetObjectField(TEXT("profile"),Profile))
    {
        double Xp=ServerXp,Coins=ServerCoins;
        (*Profile)->TryGetNumberField(TEXT("xp"),Xp); (*Profile)->TryGetNumberField(TEXT("coins"),Coins);
        ServerXp=static_cast<int32>(Xp); ServerCoins=static_cast<int32>(Coins);
    }
    ConnectionMessage=State.Status==EAL60MissionStatus::Failed?TEXT("Сервер завершил попытку без награды."):TEXT("Подключено · результат и награды проверяет сервер");
    Broadcast();
}

void UAL60MissionManager::SetMovementInput(FVector2D Direction,bool bSprint)
{
    DesiredDirection=Direction.GetClampedToMaxSize(1.f); bWantsSprint=bSprint;
}

void UAL60MissionManager::SendMovementRequest()
{
    if (bInputPending || bSyncPending || bFinishPending || bNeedsSync || State.Status!=EAL60MissionStatus::Active) return;
    bInputPending=true;
    TSharedPtr<FJsonObject> Payload=MakeShared<FJsonObject>();
    Payload->SetNumberField(TEXT("x"),DesiredDirection.X); Payload->SetNumberField(TEXT("z"),DesiredDirection.Y);
    Payload->SetBoolField(TEXT("sprint"),bWantsSprint); Payload->SetNumberField(TEXT("seq"),LastInputSeq+1);
    SendJsonRequest(TEXT("POST"),TEXT("/api/attempts/")+State.AttemptId+TEXT("/input"),Payload,
        [this](bool Ok,int32 Code,TSharedPtr<FJsonObject> Json)
    {
        bInputPending=false;
        if (!Ok) { ConnectionMessage=TEXT("Восстанавливаем связь с попыткой..."); bNeedsSync=true; NextNetworkRetry=FPlatformTime::Seconds()+1.0; return; }
        ApplyAttempt(Json);
    });
}

void UAL60MissionManager::SyncAttempt()
{
    if (bSyncPending || State.AttemptId.IsEmpty()) return;
    bSyncPending=true;
    SendJsonRequest(TEXT("GET"),TEXT("/api/attempts/")+State.AttemptId,nullptr,
        [this](bool Ok,int32 Code,TSharedPtr<FJsonObject> Json)
    {
        bSyncPending=false;
        if (Ok) { bNeedsSync=false; NextNetworkRetry=0; ApplyAttempt(Json); }
        else if (Code==401) { AccessToken.Empty(); FailMission(TEXT("Сессия истекла. Войдите снова.")); }
        else if (Code==404) FailMission(TEXT("Попытка больше недоступна на сервере."));
        else { bNeedsSync=true; NextNetworkRetry=FPlatformTime::Seconds()+2.0; ConnectionMessage=TEXT("Нет связи с сервером. Повторная проверка через 2 секунды."); }
    });
}

void UAL60MissionManager::FinishMission() { SendFinishRequest(); }
void UAL60MissionManager::SendFinishRequest()
{
    if (bFinishPending || State.AttemptId.IsEmpty() || State.Status==EAL60MissionStatus::Won || State.Status==EAL60MissionStatus::Failed) return;
    bFinishPending=true;
    State.ClientRemainingSeconds=GetRemainingSeconds(); State.Status=EAL60MissionStatus::Verifying; Broadcast();
    SendJsonRequest(TEXT("POST"),TEXT("/api/attempts/")+State.AttemptId+TEXT("/finish"),MakeShared<FJsonObject>(),
        [this](bool Ok,int32 Code,TSharedPtr<FJsonObject> Json)
    {
        bFinishPending=false;
        if (Ok) ApplyAttempt(Json);
        else if (Code==0 || Code>=500 || Code==429) { bNeedsSync=true; NextNetworkRetry=FPlatformTime::Seconds()+2.0; ConnectionMessage=TEXT("Результат пока неизвестен. Повторная проверка через 2 секунды."); }
        else FailMission(TEXT("Сервер не подтвердил прохождение. Попробуйте ещё раз."));
    },TEXT("native-finish-")+State.AttemptId);
}

void UAL60MissionManager::RegisterCheckpoint(int32 Sequence)
{
    // Kept for original trigger compatibility. A client overlap can never approve a checkpoint.
    // StagingBackend derives ordered checkpoints from its own movement simulation.
}

void UAL60MissionManager::FailMission(const FString& Reason)
{
    bNeedsSync=false; PendingStartKey.Empty();
    State.ClientRemainingSeconds=GetRemainingSeconds(); State.Status=EAL60MissionStatus::Failed;
    ConnectionMessage=Reason; Broadcast();
}

bool UAL60MissionManager::TickMission(float DeltaSeconds)
{
    if (State.Status==EAL60MissionStatus::Starting)
    {
        if (FPlatformTime::Seconds()>=NextNetworkRetry) SendStartRequest();
        return true;
    }
    if (bNeedsSync || State.Status==EAL60MissionStatus::Verifying)
    {
        if (!bFinishPending && FPlatformTime::Seconds()>=NextNetworkRetry) SyncAttempt();
        return true;
    }
    if (State.Status==EAL60MissionStatus::Active)
    {
        Broadcast();
        if (GetRemainingSeconds()<=0.f || State.CompletedCheckpoints>=State.TotalCheckpoints) SendFinishRequest();
        else SendMovementRequest();
    }
    return true;
}

void UAL60MissionManager::Broadcast()
{
    if (State.Status==EAL60MissionStatus::Active) State.ClientRemainingSeconds=GetRemainingSeconds();
    OnMissionStateChanged.Broadcast(State);
}
float UAL60MissionManager::GetRemainingSeconds() const
{
    return State.Status==EAL60MissionStatus::Active?FMath::Max(0.f,static_cast<float>(LocalDeadline-FPlatformTime::Seconds())):State.ClientRemainingSeconds;
}
FVector UAL60MissionManager::GetServerWorldPosition() const { return RouteOrigin+FVector(ServerPosition.X*100,ServerPosition.Y*100,0); }
FVector UAL60MissionManager::GetNextCheckpointWorldPosition() const
{
    if (Targets.IsValidIndex(State.CompletedCheckpoints))
    { const FVector2D P=Targets[State.CompletedCheckpoints]; return RouteOrigin+FVector(P.X*100,P.Y*100,0); }
    return RouteOrigin;
}
