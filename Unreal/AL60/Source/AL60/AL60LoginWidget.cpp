#include "AL60LoginWidget.h"
#include "AL60MissionManager.h"
#include "AL60PlayerController.h"
#include "Blueprint/WidgetTree.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/Border.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/Button.h"
#include "Components/TextBlock.h"
#include "Components/EditableTextBox.h"
#include "Engine/GameInstance.h"

void UAL60LoginWidget::NativeOnInitialized()
{
    Super::NativeOnInitialized();
    if (!WidgetTree) WidgetTree=NewObject<UWidgetTree>(this);
    UCanvasPanel* Root=WidgetTree->ConstructWidget<UCanvasPanel>(); WidgetTree->RootWidget=Root;
    UBorder* Card=WidgetTree->ConstructWidget<UBorder>(); Card->SetBrushColor(FLinearColor(.018f,.045f,.08f,.98f));
    Card->SetPadding(FMargin(28));
    UCanvasPanelSlot* Slot=Root->AddChildToCanvas(Card); Slot->SetAnchors(FAnchors(.5f,.5f));
    Slot->SetAlignment(FVector2D(.5f,.5f)); Slot->SetSize(FVector2D(610,610));
    UVerticalBox* Stack=WidgetTree->ConstructWidget<UVerticalBox>(); Card->AddChild(Stack);
    auto Text=[&](const FString& Value,int32 Size,FLinearColor Color)
    {
        UTextBlock* T=WidgetTree->ConstructWidget<UTextBlock>(); T->SetText(FText::FromString(Value));
        T->SetAutoWrapText(true); T->SetColorAndOpacity(FSlateColor(Color));
        FSlateFontInfo Font=T->GetFont(); Font.Size=Size; T->SetFont(Font);
        Stack->AddChildToVerticalBox(T)->SetPadding(FMargin(0,0,0,13)); return T;
    };
    Text(TEXT("ALMATY 60 · Подключение"),27,FLinearColor(1,.75f,.05f));
    Text(TEXT("Вход сохраняет серверные XP и демонстрационные награды. Городские истории доступны и без аккаунта."),16,FLinearColor(.8f,.87f,.9f));
    auto Field=[&](const FString& Hint,bool bSecret)
    {
        UEditableTextBox* FieldWidget=WidgetTree->ConstructWidget<UEditableTextBox>();
        FieldWidget->SetHintText(FText::FromString(Hint)); FieldWidget->SetIsPassword(bSecret);
        FEditableTextBoxStyle FieldStyle=FieldWidget->GetWidgetStyle();
        FieldStyle.TextStyle.Font.Size=19;
        FieldWidget->SetWidgetStyle(FieldStyle);
        Stack->AddChildToVerticalBox(FieldWidget)->SetPadding(FMargin(0,0,0,14)); return FieldWidget;
    };
    DisplayName=Field(TEXT("Имя для регистрации"),false);
    Email=Field(TEXT("Электронная почта"),false);
    Password=Field(TEXT("Пароль · минимум 12 символов"),true);
    Status=Text(TEXT(""),15,FLinearColor(.36f,.85f,.84f));
    UHorizontalBox* Row=WidgetTree->ConstructWidget<UHorizontalBox>(); Stack->AddChildToVerticalBox(Row)->SetPadding(FMargin(0,10,0,14));
    auto Button=[&](const FString& Label)
    {
        UButton* B=WidgetTree->ConstructWidget<UButton>(); B->SetBackgroundColor(FLinearColor(1,.75f,.05f));
        UTextBlock* T=WidgetTree->ConstructWidget<UTextBlock>(); T->SetText(FText::FromString(Label));
        T->SetColorAndOpacity(FSlateColor(FLinearColor(.02f,.04f,.08f)));
        FSlateFontInfo Font=T->GetFont(); Font.Size=18; T->SetFont(Font); B->AddChild(T);
        UHorizontalBoxSlot* BSlot=Row->AddChildToHorizontalBox(B); BSlot->SetPadding(FMargin(0,0,12,0));
        BSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill)); return B;
    };
    Button(TEXT("Войти"))->OnClicked.AddDynamic(this,&UAL60LoginWidget::SignIn);
    Button(TEXT("Регистрация"))->OnClicked.AddDynamic(this,&UAL60LoginWidget::Register);
    Button(TEXT("В город"))->OnClicked.AddDynamic(this,&UAL60LoginWidget::Close);
    Text(TEXT("Награды этого среза демонстрационные. Это виртуальное посещение, без проверки GPS."),14,FLinearColor(.66f,.74f,.79f));
}
void UAL60LoginWidget::NativeTick(const FGeometry& Geometry,float DeltaSeconds)
{
    Super::NativeTick(Geometry,DeltaSeconds);
    if (UGameInstance* GI=GetGameInstance())
        if (UAL60MissionManager* Manager=GI->GetSubsystem<UAL60MissionManager>())
        {
            Status->SetText(FText::FromString(Manager->GetConnectionMessage()));
            if (Manager->IsAuthenticated()) Close();
        }
}
void UAL60LoginWidget::Submit(bool bRegister)
{
    if (UGameInstance* GI=GetGameInstance())
        if (UAL60MissionManager* Manager=GI->GetSubsystem<UAL60MissionManager>())
            Manager->Authenticate(Email->GetText().ToString(),Password->GetText().ToString(),DisplayName->GetText().ToString(),bRegister);
}
void UAL60LoginWidget::SignIn() { Submit(false); }
void UAL60LoginWidget::Register() { Submit(true); }
void UAL60LoginWidget::Close() { if (AAL60PlayerController* PC=Cast<AAL60PlayerController>(GetOwningPlayer())) PC->CloseLogin(); }
