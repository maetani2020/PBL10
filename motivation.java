import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * motivation.java
 * ------------------------------------------
 * やる気・体力（HP）管理バックエンド
 *
 * calendar.html / calendar.js / calendar.css と整合する設計。
 * - 予定モーダルの hpCost / motivationCost（0〜100%）と連携
 * - ゲージ色分け（hp-green / hp-yellow / hp-red 等）と同じ閾値
 * - 予定データ構造（id, title, start, end, date, memo, visibility, allDay）を拡張
 * - group_share.java と同様のメモリDB + WebSocket模擬通知パターン
 */
public class motivation {

    // ==========================================
    // 定数（calendar.js / calendar.css と整合）
    // ==========================================

    /** calendar.js の STORAGE_KEY と対応するイベント保存キー */
    public static final String STORAGE_KEY_EVENTS = "shared_calendar_events";

    /** calendar.js の STORAGE_KEY と対応するユーザー設定保存キー */
    public static final String STORAGE_KEY_USER_SETTINGS = "shared_calendar_motivation_settings";

    /** HP・やる気の初期上限値（仕様: 初期値100） */
    public static final int DEFAULT_MAX_HP = 100;
    public static final int DEFAULT_MAX_MOTIVATION = 100;

    /**
     * ゲージ色分け閾値
     * calendar.js の getHpClass / getMotivationClass と同一
     *   >= 70 → green
     *   >= 40 → yellow
     *   <  40 → red
     */
    public static final int GAUGE_GREEN_THRESHOLD = 70;
    public static final int GAUGE_YELLOW_THRESHOLD = 40;

    /** 消費率の最小・最大（calendar.html の input min/max と一致） */
    public static final int COST_MIN = 0;
    public static final int COST_MAX = 100;

    /** 日付フォーマット（calendar.js の formatDate: YYYY-MM-DD） */
    public static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    /** デフォルト回復率（翌日影響判定で使用。80%回復） */
    public static final double DEFAULT_RECOVERY_RATE = 0.8;

    /** デフォルト警告閾値（合計消費が上限の何%で警告するか） */
    public static final int DEFAULT_WARNING_THRESHOLD = 80;

    // ==========================================
    // 列挙型定義
    // ==========================================

    /**
     * ゲージ表示レベル
     * calendar.css のクラス名と対応:
     *   GREEN  → hp-green / motivation-green
     *   YELLOW → hp-yellow / motivation-yellow
     *   RED    → hp-red / motivation-red
     */
    public enum GaugeLevel {
        GREEN, YELLOW, RED
    }

    /**
     * 予定の公開範囲
     * calendar.html の eventVisibility と対応:
     *   PUBLIC  → "public"  （全体公開）
     *   GROUP   → "group"   （グループ公開）
     *   PRIVATE → "private" （自分のみ）
     */
    public enum Visibility {
        PUBLIC("public"),
        GROUP("group"),
        PRIVATE("private");

        private final String value;

        Visibility(String value) {
            this.value = value;
        }

        public String getValue() {
            return value;
        }

        public static Visibility fromValue(String value) {
            for (Visibility v : values()) {
                if (v.value.equals(value)) {
                    return v;
                }
            }
            return PUBLIC;
        }
    }

    // ==========================================
    // インナークラス（データ構造）
    // ==========================================

    /**
     * ユーザーごとのHP・やる気設定
     * 機能: HP上限設定 / やる気設定 / ユーザー設定
     */
    public static class UserMotivationSettings {
        public String userId;
        /** 1日の最大HP（初期値100） */
        public int maxHp = DEFAULT_MAX_HP;
        /** 1日の最大やる気（初期値100） */
        public int maxMotivation = DEFAULT_MAX_MOTIVATION;
        /** 翌日への回復率（0.0〜1.0。例: 0.8 = 80%回復） */
        public double recoveryRate = DEFAULT_RECOVERY_RATE;
        /** 合計消費が上限の何%を超えたら警告するか（初期値80%） */
        public int warningThreshold = DEFAULT_WARNING_THRESHOLD;

        public UserMotivationSettings(String userId) {
            this.userId = userId;
        }
    }

    /**
     * カレンダー予定
     * calendar.js のイベント構造を拡張し、HP・やる気消費率を追加
     * 機能: HP消費量設定 / やる気消費量設定
     */
    public static class CalendarEvent {
        public long id;
        public String title;
        public String start;       // datetime-local 形式（例: 2026-06-18T09:00）
        public String end;
        public String date;        // YYYY-MM-DD（calendar.js の date フィールド）
        public String memo;
        public Visibility visibility;
        public boolean allDay;
        /** 想定消費HP（0〜100%）— calendar.html の #hpCost */
        public int hpCost;
        /** 想定消費やる気（0〜100%）— calendar.html の #motivationCost */
        public int motivationCost;
        public String ownerId;

        public CalendarEvent(long id, String title, String start, String end,
                             String date, String memo, Visibility visibility,
                             boolean allDay, int hpCost, int motivationCost,
                             String ownerId) {
            this.id = id;
            this.title = title;
            this.start = start;
            this.end = end;
            this.date = date;
            this.memo = memo;
            this.visibility = visibility;
            this.allDay = allDay;
            this.hpCost = hpCost;
            this.motivationCost = motivationCost;
            this.ownerId = ownerId;
        }
    }

    /**
     * 日別ステータス（残HP・残やる気）
     * 機能: 自動計算 / カレンダー表示 / ゲージ表示 / キャパシティ判定
     */
    public static class DayStatus {
        public String date;
        public int maxHp;
        public int maxMotivation;
        public int totalHpCost;
        public int totalMotivationCost;
        public int remainHp;
        public int remainMotivation;
        public GaugeLevel hpGaugeLevel;
        public GaugeLevel motivationGaugeLevel;
        /** calendar.css 用クラス名（例: hp-green） */
        public String hpCssClass;
        public String motivationCssClass;
        public boolean capacityExceeded;
        public String warningMessage;

        public DayStatus(String date) {
            this.date = date;
        }
    }

    /**
     * 日別消費履歴
     * 機能: 消費履歴閲覧
     */
    public static class ConsumptionHistory {
        public String date;
        public int hpConsumed;
        public int motivationConsumed;
        public int eventCount;
        public List<String> eventTitles = new ArrayList<>();

        public ConsumptionHistory(String date) {
            this.date = date;
        }
    }

    /**
     * 統計グラフ用データポイント
     * 機能: 統計分析（折れ線グラフ）
     */
    public static class StatPoint {
        public String date;
        public int remainHp;
        public int remainMotivation;
        public int totalHpCost;
        public int totalMotivationCost;

        public StatPoint(String date, int remainHp, int remainMotivation,
                         int totalHpCost, int totalMotivationCost) {
            this.date = date;
            this.remainHp = remainHp;
            this.remainMotivation = remainMotivation;
            this.totalHpCost = totalHpCost;
            this.totalMotivationCost = totalMotivationCost;
        }
    }

    /**
     * 予定保存前チェック結果
     * 機能: 予定登録支援 / キャパシティ判定
     */
    public static class PreSaveCheckResult {
        public boolean canSave;
        public String message;
        public boolean hpInsufficient;
        public boolean motivationInsufficient;
        public boolean capacityExceeded;
        public int projectedRemainHp;
        public int projectedRemainMotivation;

        public PreSaveCheckResult(boolean canSave, String message) {
            this.canSave = canSave;
            this.message = message;
        }
    }

    /**
     * 翌日影響判定結果
     * 機能: 翌日影響判定（回復率計算を利用）
     */
    public static class NextDayImpact {
        public String sourceDate;
        public String nextDate;
        public boolean needsAttention;
        public int todayRemainHp;
        public int todayRemainMotivation;
        public int projectedNextDayHp;
        public int projectedNextDayMotivation;
        public String alertMessage;

        public NextDayImpact(String sourceDate, String nextDate) {
            this.sourceDate = sourceDate;
            this.nextDate = nextDate;
        }
    }

    /**
     * 休息提案
     * 機能: 休息提案（AI機能連携可能）
     */
    public static class RestSuggestion {
        public String date;
        public String suggestedStart;
        public String suggestedEnd;
        public int durationMinutes;
        public String reason;
        /** true の場合、外部AI API連携で生成された提案 */
        public boolean aiGenerated;

        public RestSuggestion(String date, String suggestedStart, String suggestedEnd,
                            int durationMinutes, String reason, boolean aiGenerated) {
            this.date = date;
            this.suggestedStart = suggestedStart;
            this.suggestedEnd = suggestedEnd;
            this.durationMinutes = durationMinutes;
            this.reason = reason;
            this.aiGenerated = aiGenerated;
        }
    }

    /**
     * カレンダー日セル描画用DTO
     * calendar.js の renderMonthView が利用する dayStatus 相当
     * 機能: カレンダー表示 / ゲージ表示
     */
    public static class CalendarDayDisplay {
        public String date;
        public int remainHp;
        public int remainMotivation;
        public String hpCssClass;
        public String motivationCssClass;
        public String hpLabel;
        public String motivationLabel;
        public boolean showWarning;

        public CalendarDayDisplay(String date, int remainHp, int remainMotivation,
                                  String hpCssClass, String motivationCssClass) {
            this.date = date;
            this.remainHp = remainHp;
            this.remainMotivation = remainMotivation;
            this.hpCssClass = hpCssClass;
            this.motivationCssClass = motivationCssClass;
            this.hpLabel = "HP " + remainHp + "%";
            this.motivationLabel = "やる気 " + remainMotivation + "%";
        }
    }

    // ==========================================
    // 模擬データベース（メモリ管理）
    // group_share.java と同様のパターン
    // ==========================================

    /** ユーザーID → ユーザー設定 */
    private Map<String, UserMotivationSettings> userSettingsTable = new HashMap<>();

    /** 全予定リスト（calendar.js の getEvents / saveEvents 相当） */
    private List<CalendarEvent> eventsTable = new ArrayList<>();

    // ==========================================
    // 1. HP（体力）設定
    //    ユーザーごとに1日の最大HPを設定する（初期値100）
    // ==========================================

    /**
     * ユーザーのHP・やる気設定を取得する。
     * 未登録の場合は初期値（maxHp=100, maxMotivation=100）で自動作成。
     */
    public UserMotivationSettings getUserSettings(String userId) {
        return userSettingsTable.computeIfAbsent(userId, UserMotivationSettings::new);
    }

    /**
     * 1日の最大HPを設定する。
     *
     * @param userId  ユーザーID
     * @param maxHp   上限値（1〜100推奨）
     * @return 更新後の設定
     */
    public UserMotivationSettings setMaxHp(String userId, int maxHp) {
        UserMotivationSettings settings = getUserSettings(userId);
        settings.maxHp = clamp(maxHp, 1, COST_MAX);
        System.out.println("ユーザー「" + userId + "」の最大HPを " + settings.maxHp + " に設定しました。");
        return settings;
    }

    // ==========================================
    // 2. やる気設定
    //    ユーザーごとに1日のやる気ゲージを設定する（初期値100）
    // ==========================================

    /**
     * 1日の最大やる気を設定する。
     *
     * @param userId          ユーザーID
     * @param maxMotivation   上限値（1〜100推奨）
     * @return 更新後の設定
     */
    public UserMotivationSettings setMaxMotivation(String userId, int maxMotivation) {
        UserMotivationSettings settings = getUserSettings(userId);
        settings.maxMotivation = clamp(maxMotivation, 1, COST_MAX);
        System.out.println("ユーザー「" + userId + "」の最大やる気を " + settings.maxMotivation + " に設定しました。");
        return settings;
    }

    // ==========================================
    // 3. HP消費量設定 / 4. やる気消費量設定
    //    予定登録時に想定消費HP・やる気を設定する（0〜100%）
    //    calendar.html の #hpCost / #motivationCost と連携
    // ==========================================

    /**
     * 消費率のバリデーション（0〜100%）
     */
    public boolean validateCost(int cost) {
        return cost >= COST_MIN && cost <= COST_MAX;
    }

    /**
     * 予定を登録する（新規）。
     * HP・やる気消費率を含む。
     * 保存前に事前チェック（予定登録支援）を実行する。
     *
     * @param event 登録する予定
     * @return 登録成功なら true
     */
    public boolean registerEvent(CalendarEvent event) {
        if (!validateCost(event.hpCost) || !validateCost(event.motivationCost)) {
            System.out.println("エラー: 消費率は0〜100%の範囲で設定してください。");
            return false;
        }

        PreSaveCheckResult check = preSaveCheck(
                event.ownerId, event.date, event.hpCost, event.motivationCost, null
        );

        if (!check.canSave) {
            System.out.println("登録拒否: " + check.message);
            return false;
        }

        eventsTable.add(event);
        System.out.println("予定「" + event.title + "」を登録しました。" +
                " (HP消費:" + event.hpCost + "%, やる気消費:" + event.motivationCost + "%)");

        // リアルタイム更新: WebSocket模擬通知
        broadcastMotivationUpdate(event.ownerId, event.date, "EVENT_REGISTERED");
        return true;
    }

    /**
     * 予定を更新する（編集）。
     * calendar.js の saveEvent 編集モード相当。
     *
     * @param eventId     更新対象の予定ID
     * @param updated     更新内容
     * @return 更新成功なら true
     */
    public boolean updateEvent(long eventId, CalendarEvent updated) {
        CalendarEvent existing = findEventById(eventId);
        if (existing == null) {
            System.out.println("エラー: 予定が見つかりません (id=" + eventId + ")");
            return false;
        }

        if (!validateCost(updated.hpCost) || !validateCost(updated.motivationCost)) {
            System.out.println("エラー: 消費率は0〜100%の範囲で設定してください。");
            return false;
        }

        PreSaveCheckResult check = preSaveCheck(
                updated.ownerId, updated.date, updated.hpCost, updated.motivationCost, eventId
        );

        if (!check.canSave) {
            System.out.println("更新拒否: " + check.message);
            return false;
        }

        existing.title = updated.title;
        existing.start = updated.start;
        existing.end = updated.end;
        existing.date = updated.date;
        existing.memo = updated.memo;
        existing.visibility = updated.visibility;
        existing.allDay = updated.allDay;
        existing.hpCost = updated.hpCost;
        existing.motivationCost = updated.motivationCost;

        System.out.println("予定「" + existing.title + "」を更新しました。");
        broadcastMotivationUpdate(existing.ownerId, existing.date, "EVENT_UPDATED");
        return true;
    }

    /**
     * 予定を削除する。
     * calendar.js の deleteEvent 相当。
     */
    public boolean deleteEvent(long eventId) {
        CalendarEvent existing = findEventById(eventId);
        if (existing == null) {
            return false;
        }

        eventsTable.remove(existing);
        System.out.println("予定「" + existing.title + "」を削除しました。");
        broadcastMotivationUpdate(existing.ownerId, existing.date, "EVENT_DELETED");
        return true;
    }

    // ==========================================
    // 5. 自動計算
    //    登録された予定の消費量を合計し残HPを算出（リアルタイム更新）
    // ==========================================

    /**
     * 指定日の合計HP消費率を算出する。
     */
    public int calculateTotalHpCost(String userId, String date) {
        return getEventsByDateAndOwner(userId, date).stream()
                .mapToInt(e -> e.hpCost)
                .sum();
    }

    /**
     * 指定日の合計やる気消費率を算出する。
     */
    public int calculateTotalMotivationCost(String userId, String date) {
        return getEventsByDateAndOwner(userId, date).stream()
                .mapToInt(e -> e.motivationCost)
                .sum();
    }

    /**
     * 指定日の残HPを算出する。
     * 計算式: max(0, maxHp - 合計HP消費率)
     */
    public int calculateRemainHp(String userId, String date) {
        UserMotivationSettings settings = getUserSettings(userId);
        int totalCost = calculateTotalHpCost(userId, date);
        return Math.max(0, settings.maxHp - totalCost);
    }

    /**
     * 指定日の残やる気を算出する。
     * 計算式: max(0, maxMotivation - 合計やる気消費率)
     */
    public int calculateRemainMotivation(String userId, String date) {
        UserMotivationSettings settings = getUserSettings(userId);
        int totalCost = calculateTotalMotivationCost(userId, date);
        return Math.max(0, settings.maxMotivation - totalCost);
    }

    /**
     * 指定日のステータスを総合的に算出する。
     * calendar.js の dayStatus 相当オブジェクトを生成。
     */
    public DayStatus calculateDayStatus(String userId, String date) {
        UserMotivationSettings settings = getUserSettings(userId);
        DayStatus status = new DayStatus(date);

        status.maxHp = settings.maxHp;
        status.maxMotivation = settings.maxMotivation;
        status.totalHpCost = calculateTotalHpCost(userId, date);
        status.totalMotivationCost = calculateTotalMotivationCost(userId, date);
        status.remainHp = Math.max(0, settings.maxHp - status.totalHpCost);
        status.remainMotivation = Math.max(0, settings.maxMotivation - status.totalMotivationCost);

        status.hpGaugeLevel = resolveGaugeLevel(status.remainHp);
        status.motivationGaugeLevel = resolveGaugeLevel(status.remainMotivation);
        status.hpCssClass = toCssClass("hp", status.hpGaugeLevel);
        status.motivationCssClass = toCssClass("motivation", status.motivationGaugeLevel);

        // キャパシティ判定
        status.capacityExceeded = isCapacityExceeded(userId, date);
        if (status.capacityExceeded) {
            status.warningMessage = buildCapacityWarning(userId, date);
        }

        return status;
    }

    // ==========================================
    // 6. カレンダー表示
    //    日毎の残HP・残やる気をカレンダー上に表示（色分け表示）
    //    calendar.js の renderMonthView 内 hp-info / motivation-info と連携
    // ==========================================

    /**
     * 月間カレンダー表示用データを一括生成する。
     *
     * @param userId ユーザーID
     * @param year   年
     * @param month  月（1〜12）
     * @return 日付文字列 → 表示用DTO のマップ
     */
    public Map<String, CalendarDayDisplay> buildMonthCalendarDisplay(String userId, int year, int month) {
        Map<String, CalendarDayDisplay> result = new HashMap<>();
        LocalDate firstDay = LocalDate.of(year, month, 1);
        int daysInMonth = firstDay.lengthOfMonth();

        for (int day = 1; day <= daysInMonth; day++) {
            String dateStr = firstDay.withDayOfMonth(day).format(DATE_FORMAT);
            DayStatus status = calculateDayStatus(userId, dateStr);

            CalendarDayDisplay display = new CalendarDayDisplay(
                    dateStr,
                    status.remainHp,
                    status.remainMotivation,
                    status.hpCssClass,
                    status.motivationCssClass
            );
            display.showWarning = status.capacityExceeded;
            result.put(dateStr, display);
        }

        return result;
    }

    /**
     * 単一日のカレンダー表示データを取得する。
     * calendar.js 内の以下と同等:
     *   const hp = dayStatus?.remainHP ?? 100;
     *   const motivation = dayStatus?.remainMotivation ?? 100;
     */
    public CalendarDayDisplay getCalendarDayDisplay(String userId, String date) {
        DayStatus status = calculateDayStatus(userId, date);
        CalendarDayDisplay display = new CalendarDayDisplay(
                date,
                status.remainHp,
                status.remainMotivation,
                status.hpCssClass,
                status.motivationCssClass
        );
        display.showWarning = status.capacityExceeded;
        return display;
    }

    // ==========================================
    // 7. ゲージ表示
    //    残HP・残やる気をゲージ形式で表示（緑・黄・赤で状態表示）
    //    calendar.js の getHpClass / getMotivationClass と整合
    // ==========================================

    /**
     * 残量からゲージレベルを判定する。
     * calendar.js:
     *   if (hp >= 70) return "hp-green";
     *   if (hp >= 40) return "hp-yellow";
     *   return "hp-red";
     */
    public GaugeLevel resolveGaugeLevel(int remainValue) {
        if (remainValue >= GAUGE_GREEN_THRESHOLD) {
            return GaugeLevel.GREEN;
        }
        if (remainValue >= GAUGE_YELLOW_THRESHOLD) {
            return GaugeLevel.YELLOW;
        }
        return GaugeLevel.RED;
    }

    /**
     * ゲージレベルを calendar.css 用クラス名に変換する。
     *
     * @param prefix "hp" または "motivation"
     * @param level  ゲージレベル
     * @return 例: "hp-green", "motivation-red"
     */
    public String toCssClass(String prefix, GaugeLevel level) {
        switch (level) {
            case GREEN:
                return prefix + "-green";
            case YELLOW:
                return prefix + "-yellow";
            default:
                return prefix + "-red";
        }
    }

    /**
     * ゲージ表示用の詳細情報を返す（フロントエンド描画支援）。
     */
    public Map<String, Object> buildGaugeDisplayData(String userId, String date) {
        DayStatus status = calculateDayStatus(userId, date);
        Map<String, Object> data = new HashMap<>();
        data.put("date", date);
        data.put("remainHp", status.remainHp);
        data.put("remainMotivation", status.remainMotivation);
        data.put("hpCssClass", status.hpCssClass);
        data.put("motivationCssClass", status.motivationCssClass);
        data.put("hpPercent", status.remainHp);
        data.put("motivationPercent", status.remainMotivation);
        data.put("hpGaugeLevel", status.hpGaugeLevel.name());
        data.put("motivationGaugeLevel", status.motivationGaugeLevel.name());
        return data;
    }

    // ==========================================
    // 8. キャパシティ判定
    //    合計消費量が設定上限を超えた場合に警告を出す（超過判定）
    // ==========================================

    /**
     * 合計消費が上限を超えているか判定する。
     */
    public boolean isCapacityExceeded(String userId, String date) {
        UserMotivationSettings settings = getUserSettings(userId);
        int totalHp = calculateTotalHpCost(userId, date);
        int totalMotivation = calculateTotalMotivationCost(userId, date);
        return totalHp > settings.maxHp || totalMotivation > settings.maxMotivation;
    }

    /**
     * 警告閾値を超えているか判定する（上限未満だが要注意）。
     */
    public boolean isWarningThresholdExceeded(String userId, String date) {
        UserMotivationSettings settings = getUserSettings(userId);
        int totalHp = calculateTotalHpCost(userId, date);
        int totalMotivation = calculateTotalMotivationCost(userId, date);
        int hpWarningLine = (int) (settings.maxHp * settings.warningThreshold / 100.0);
        int motivationWarningLine = (int) (settings.maxMotivation * settings.warningThreshold / 100.0);
        return totalHp >= hpWarningLine || totalMotivation >= motivationWarningLine;
    }

    /**
     * キャパシティ超過時の警告メッセージを生成する。
     */
    public String buildCapacityWarning(String userId, String date) {
        UserMotivationSettings settings = getUserSettings(userId);
        int totalHp = calculateTotalHpCost(userId, date);
        int totalMotivation = calculateTotalMotivationCost(userId, date);

        StringBuilder sb = new StringBuilder();
        sb.append(date).append(" の予定消費が上限を超えています。");

        if (totalHp > settings.maxHp) {
            sb.append(" HP: ").append(totalHp).append("% / 上限 ").append(settings.maxHp).append("%");
        }
        if (totalMotivation > settings.maxMotivation) {
            if (totalHp > settings.maxHp) sb.append("、");
            sb.append(" やる気: ").append(totalMotivation).append("% / 上限 ")
                    .append(settings.maxMotivation).append("%");
        }

        return sb.toString();
    }

    // ==========================================
    // 9. 予定登録支援
    //    新しい予定追加時にHP不足を事前判定する（予定保存前チェック）
    //    calendar.js の saveEvent 実行前に呼び出す想定
    // ==========================================

    /**
     * 予定保存前にHP・やる気の不足を事前判定する。
     *
     * @param userId              ユーザーID
     * @param date                予定日（YYYY-MM-DD）
     * @param additionalHpCost    追加するHP消費率
     * @param additionalMotivationCost 追加するやる気消費率
     * @param excludeEventId      編集時に除外する予定ID（新規時は null）
     * @return チェック結果
     */
    public PreSaveCheckResult preSaveCheck(String userId, String date,
                                           int additionalHpCost, int additionalMotivationCost,
                                           Long excludeEventId) {
        UserMotivationSettings settings = getUserSettings(userId);

        int currentHpCost = getEventsByDateAndOwner(userId, date).stream()
                .filter(e -> excludeEventId == null || e.id != excludeEventId)
                .mapToInt(e -> e.hpCost)
                .sum();

        int currentMotivationCost = getEventsByDateAndOwner(userId, date).stream()
                .filter(e -> excludeEventId == null || e.id != excludeEventId)
                .mapToInt(e -> e.motivationCost)
                .sum();

        int projectedHpCost = currentHpCost + additionalHpCost;
        int projectedMotivationCost = currentMotivationCost + additionalMotivationCost;
        int projectedRemainHp = Math.max(0, settings.maxHp - projectedHpCost);
        int projectedRemainMotivation = Math.max(0, settings.maxMotivation - projectedMotivationCost);

        PreSaveCheckResult result = new PreSaveCheckResult(true, "保存可能です。");
        result.projectedRemainHp = projectedRemainHp;
        result.projectedRemainMotivation = projectedRemainMotivation;

        if (projectedHpCost > settings.maxHp) {
            result.canSave = false;
            result.hpInsufficient = true;
            result.capacityExceeded = true;
            result.message = "HPが不足します。残り " +
                    Math.max(0, settings.maxHp - currentHpCost) +
                    "% ですが、" + additionalHpCost + "% の消費が必要です。";
            return result;
        }

        if (projectedMotivationCost > settings.maxMotivation) {
            result.canSave = false;
            result.motivationInsufficient = true;
            result.capacityExceeded = true;
            result.message = "やる気が不足します。残り " +
                    Math.max(0, settings.maxMotivation - currentMotivationCost) +
                    "% ですが、" + additionalMotivationCost + "% の消費が必要です。";
            return result;
        }

        if (isWarningThresholdExceededAfterAdd(userId, projectedHpCost, projectedMotivationCost)) {
            result.message = "保存は可能ですが、消費量が警告閾値（" +
                    settings.warningThreshold + "%）を超えます。ご注意ください。";
        }

        return result;
    }

    // ==========================================
    // 10. 翌日影響判定
    //     当日の消費量が過大な場合、翌日の予定にも注意喚起（回復率計算を利用）
    // ==========================================

    /**
     * 回復率を用いて翌日の開始時HP・やる気を予測する。
     * 計算式: min(上限, 当日残量 + 上限 × 回復率)
     */
    public int calculateRecoveredValue(int remainValue, int maxValue, double recoveryRate) {
        int recovered = remainValue + (int) (maxValue * recoveryRate);
        return Math.min(maxValue, recovered);
    }

    /**
     * 当日の過大消費が翌日に与える影響を判定する。
     */
    public NextDayImpact evaluateNextDayImpact(String userId, String date) {
        UserMotivationSettings settings = getUserSettings(userId);
        LocalDate source = LocalDate.parse(date, DATE_FORMAT);
        String nextDate = source.plusDays(1).format(DATE_FORMAT);

        NextDayImpact impact = new NextDayImpact(date, nextDate);
        DayStatus todayStatus = calculateDayStatus(userId, date);

        impact.todayRemainHp = todayStatus.remainHp;
        impact.todayRemainMotivation = todayStatus.remainMotivation;
        impact.projectedNextDayHp = calculateRecoveredValue(
                todayStatus.remainHp, settings.maxHp, settings.recoveryRate
        );
        impact.projectedNextDayMotivation = calculateRecoveredValue(
                todayStatus.remainMotivation, settings.maxMotivation, settings.recoveryRate
        );

        // 翌日の予定消費を加味した判定
        int nextDayHpCost = calculateTotalHpCost(userId, nextDate);
        int nextDayMotivationCost = calculateTotalMotivationCost(userId, nextDate);
        int nextDayEffectiveHp = impact.projectedNextDayHp - nextDayHpCost;
        int nextDayEffectiveMotivation = impact.projectedNextDayMotivation - nextDayMotivationCost;

        boolean todayExhausted = todayStatus.remainHp < GAUGE_YELLOW_THRESHOLD
                || todayStatus.remainMotivation < GAUGE_YELLOW_THRESHOLD;
        boolean nextDayRisk = nextDayEffectiveHp < GAUGE_YELLOW_THRESHOLD
                || nextDayEffectiveMotivation < GAUGE_YELLOW_THRESHOLD;

        impact.needsAttention = todayExhausted || nextDayRisk;

        if (impact.needsAttention) {
            impact.alertMessage = nextDate + " の予定に注意が必要です。" +
                    " 回復後HP: " + impact.projectedNextDayHp + "%" +
                    "（予定消費後: " + Math.max(0, nextDayEffectiveHp) + "%）、" +
                    " 回復後やる気: " + impact.projectedNextDayMotivation + "%" +
                    "（予定消費後: " + Math.max(0, nextDayEffectiveMotivation) + "%）。" +
                    " 前日（" + date + "）の消費が影響している可能性があります。";
        }

        return impact;
    }

    // ==========================================
    // 11. 休息提案
    //     HP不足時に空き時間への休憩登録を提案する（AI機能連携可能）
    // ==========================================

    /**
     * 指定日の空き時間に休憩登録を提案する。
     * ルールベースで空き時間を検出し、必要に応じてAI連携も可能。
     *
     * @param userId       ユーザーID
     * @param date         対象日
     * @param useAi        true の場合、外部AI API連携を試行（未接続時はルールベースにフォールバック）
     * @return 休息提案リスト
     */
    public List<RestSuggestion> suggestRestBreaks(String userId, String date, boolean useAi) {
        List<RestSuggestion> suggestions = new ArrayList<>();
        DayStatus status = calculateDayStatus(userId, date);

        // HPまたはやる気が黄以下の場合のみ提案
        if (status.remainHp >= GAUGE_YELLOW_THRESHOLD
                && status.remainMotivation >= GAUGE_YELLOW_THRESHOLD) {
            return suggestions;
        }

        List<CalendarEvent> dayEvents = getEventsByDateAndOwner(userId, date).stream()
                .filter(e -> !e.allDay)
                .sorted(Comparator.comparing(e -> e.start))
                .collect(Collectors.toList());

        List<TimeSlot> freeSlots = findFreeTimeSlots(dayEvents, date);

        for (TimeSlot slot : freeSlots) {
            if (slot.durationMinutes >= 30) {
                String reason = buildRestReason(status);
                boolean aiGenerated = false;

                if (useAi) {
                    // AI機能連携ポイント（外部API呼び出しを想定）
                    RestSuggestion aiSuggestion = requestAiRestSuggestion(userId, date, slot, status);
                    if (aiSuggestion != null) {
                        suggestions.add(aiSuggestion);
                        continue;
                    }
                    aiGenerated = false; // AI未接続時はルールベース
                }

                int restMinutes = Math.min(slot.durationMinutes, 60);
                String restEnd = slot.start.plusMinutes(restMinutes)
                        .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm"));

                suggestions.add(new RestSuggestion(
                        date,
                        slot.start.format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")),
                        restEnd,
                        restMinutes,
                        reason,
                        aiGenerated
                ));
            }
        }

        if (suggestions.isEmpty() && status.remainHp < GAUGE_YELLOW_THRESHOLD) {
            suggestions.add(new RestSuggestion(
                    date,
                    date + "T12:00",
                    date + "T13:00",
                    60,
                    "空き時間が見つかりませんでした。昼休みなどに意識的な休憩を取ることをお勧めします。",
                    false
            ));
        }

        return suggestions;
    }

    /**
     * AI連携用の休息提案リクエスト（スタブ実装）。
     * 実運用では OpenAI / Gemini 等のAPIを呼び出す。
     */
    private RestSuggestion requestAiRestSuggestion(String userId, String date,
                                                    TimeSlot slot, DayStatus status) {
        // AI API未接続時は null を返し、ルールベースにフォールバック
        System.out.println("[AI連携] 休息提案リクエスト（スタブ）: user=" + userId +
                ", date=" + date + ", 空き=" + slot.durationMinutes + "分");
        return null;
    }

    // ==========================================
    // 12. 統計分析
    //     週間・月間のHP推移をグラフ表示する（折れ線グラフ）
    // ==========================================

    /**
     * 週間のHP・やる気推移データを取得する（折れ線グラフ用）。
     *
     * @param userId     ユーザーID
     * @param startDate  週の開始日（YYYY-MM-DD）
     * @return 7日分の統計データポイント
     */
    public List<StatPoint> getWeeklyStats(String userId, String startDate) {
        List<StatPoint> points = new ArrayList<>();
        LocalDate start = LocalDate.parse(startDate, DATE_FORMAT);

        for (int i = 0; i < 7; i++) {
            String date = start.plusDays(i).format(DATE_FORMAT);
            points.add(buildStatPoint(userId, date));
        }

        return points;
    }

    /**
     * 月間のHP・やる気推移データを取得する（折れ線グラフ用）。
     *
     * @param userId  ユーザーID
     * @param year    年
     * @param month   月（1〜12）
     * @return 当月全日分の統計データポイント
     */
    public List<StatPoint> getMonthlyStats(String userId, int year, int month) {
        List<StatPoint> points = new ArrayList<>();
        LocalDate firstDay = LocalDate.of(year, month, 1);
        int daysInMonth = firstDay.lengthOfMonth();

        for (int day = 1; day <= daysInMonth; day++) {
            String date = firstDay.withDayOfMonth(day).format(DATE_FORMAT);
            points.add(buildStatPoint(userId, date));
        }

        return points;
    }

    /**
     * 統計データポイントを1日分生成する。
     */
    private StatPoint buildStatPoint(String userId, String date) {
        DayStatus status = calculateDayStatus(userId, date);
        return new StatPoint(
                date,
                status.remainHp,
                status.remainMotivation,
                status.totalHpCost,
                status.totalMotivationCost
        );
    }

    // ==========================================
    // 13. 消費履歴閲覧
    //     日別のHP消費履歴を確認する（過去データ参照）
    // ==========================================

    /**
     * 指定日の消費履歴を取得する。
     */
    public ConsumptionHistory getConsumptionHistory(String userId, String date) {
        ConsumptionHistory history = new ConsumptionHistory(date);
        List<CalendarEvent> dayEvents = getEventsByDateAndOwner(userId, date);

        history.hpConsumed = dayEvents.stream().mapToInt(e -> e.hpCost).sum();
        history.motivationConsumed = dayEvents.stream().mapToInt(e -> e.motivationCost).sum();
        history.eventCount = dayEvents.size();
        history.eventTitles = dayEvents.stream()
                .map(e -> e.title)
                .collect(Collectors.toList());

        return history;
    }

    /**
     * 期間指定で消費履歴を一括取得する（過去データ参照）。
     *
     * @param userId    ユーザーID
     * @param startDate 開始日（YYYY-MM-DD）
     * @param endDate   終了日（YYYY-MM-DD）
     * @return 日別消費履歴リスト
     */
    public List<ConsumptionHistory> getConsumptionHistoryRange(String userId,
                                                                String startDate,
                                                                String endDate) {
        List<ConsumptionHistory> histories = new ArrayList<>();
        LocalDate start = LocalDate.parse(startDate, DATE_FORMAT);
        LocalDate end = LocalDate.parse(endDate, DATE_FORMAT);
        long days = ChronoUnit.DAYS.between(start, end);

        for (int i = 0; i <= days; i++) {
            String date = start.plusDays(i).format(DATE_FORMAT);
            histories.add(getConsumptionHistory(userId, date));
        }

        return histories;
    }

    // ==========================================
    // 14. ユーザー設定
    //     HP上限値・回復率・警告閾値を変更できる（個人設定）
    // ==========================================

    /**
     * ユーザー設定を一括更新する。
     *
     * @param userId           ユーザーID
     * @param maxHp            最大HP（null の場合は変更なし）
     * @param maxMotivation    最大やる気（null の場合は変更なし）
     * @param recoveryRate     回復率（null の場合は変更なし）
     * @param warningThreshold 警告閾値（null の場合は変更なし）
     * @return 更新後の設定
     */
    public UserMotivationSettings updateUserSettings(String userId,
                                                      Integer maxHp,
                                                      Integer maxMotivation,
                                                      Double recoveryRate,
                                                      Integer warningThreshold) {
        UserMotivationSettings settings = getUserSettings(userId);

        if (maxHp != null) {
            settings.maxHp = clamp(maxHp, 1, COST_MAX);
        }
        if (maxMotivation != null) {
            settings.maxMotivation = clamp(maxMotivation, 1, COST_MAX);
        }
        if (recoveryRate != null) {
            settings.recoveryRate = clamp(recoveryRate, 0.0, 1.0);
        }
        if (warningThreshold != null) {
            settings.warningThreshold = clamp(warningThreshold, 1, COST_MAX);
        }

        System.out.println("ユーザー「" + userId + "」の設定を更新しました。" +
                " HP上限=" + settings.maxHp +
                ", やる気上限=" + settings.maxMotivation +
                ", 回復率=" + settings.recoveryRate +
                ", 警告閾値=" + settings.warningThreshold + "%");

        broadcastMotivationUpdate(userId, null, "SETTINGS_UPDATED");
        return settings;
    }

    /**
     * 回復率のみ変更する。
     */
    public UserMotivationSettings setRecoveryRate(String userId, double recoveryRate) {
        return updateUserSettings(userId, null, null, recoveryRate, null);
    }

    /**
     * 警告閾値のみ変更する。
     */
    public UserMotivationSettings setWarningThreshold(String userId, int warningThreshold) {
        return updateUserSettings(userId, null, null, null, warningThreshold);
    }

    // ==========================================
    // システム機能: WebSocketリアルタイム更新
    // group_share.java の broadcastToGroup と同様のパターン
    // calendar.js の refreshCalendar / renderAll トリガー想定
    // ==========================================

    /**
     * HP・やる気の変更をフロントエンドへリアルタイム通知する（模擬）。
     * 予定の登録・更新・削除・設定変更時に呼び出される。
     */
    private void broadcastMotivationUpdate(String userId, String date, String action) {
        System.out.println("--- [WebSocket通知: Motivation] ---");
        System.out.println("ユーザー「" + userId + "」へ通知送信 [" + action + "]");

        if (date != null) {
            DayStatus status = calculateDayStatus(userId, date);
            System.out.println("  日付: " + date +
                    " | 残HP: " + status.remainHp + "% (" + status.hpCssClass + ")" +
                    " | 残やる気: " + status.remainMotivation + "% (" + status.motivationCssClass + ")");

            if (status.capacityExceeded) {
                System.out.println("  ⚠ 警告: " + status.warningMessage);
            }
        }

        System.out.println("  → フロントエンド: refreshCalendar() / renderAll() を実行");
        System.out.println("-----------------------------------");
    }

    // ==========================================
    // ユーティリティ（内部ヘルパー）
    // ==========================================

    /**
     * 指定ユーザー・指定日の予定を取得する。
     * calendar.js の getEventsByDate 相当（ownerId フィルタ付き）
     */
    public List<CalendarEvent> getEventsByDateAndOwner(String userId, String date) {
        return eventsTable.stream()
                .filter(e -> e.ownerId.equals(userId) && e.date.equals(date))
                .collect(Collectors.toList());
    }

    /**
     * 全予定を取得する。
     * calendar.js の getEvents 相当
     */
    public List<CalendarEvent> getAllEvents() {
        return new ArrayList<>(eventsTable);
    }

    /**
     * IDで予定を検索する。
     */
    public CalendarEvent findEventById(long eventId) {
        return eventsTable.stream()
                .filter(e -> e.id == eventId)
                .findFirst()
                .orElse(null);
    }

    /**
     * 予定データを一括ロードする（LocalStorage復元想定）。
     */
    public void loadEvents(List<CalendarEvent> events) {
        eventsTable.clear();
        if (events != null) {
            eventsTable.addAll(events);
        }
    }

    /**
     * 整数クランプ
     */
    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * 浮動小数点クランプ
     */
    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * 追加後の警告閾値超過判定
     */
    private boolean isWarningThresholdExceededAfterAdd(String userId,
                                                        int projectedHpCost,
                                                        int projectedMotivationCost) {
        UserMotivationSettings settings = getUserSettings(userId);
        int hpWarningLine = (int) (settings.maxHp * settings.warningThreshold / 100.0);
        int motivationWarningLine = (int) (settings.maxMotivation * settings.warningThreshold / 100.0);
        return projectedHpCost >= hpWarningLine || projectedMotivationCost >= motivationWarningLine;
    }

    /**
     * 休息提案理由文を生成する。
     */
    private String buildRestReason(DayStatus status) {
        if (status.remainHp < GAUGE_YELLOW_THRESHOLD && status.remainMotivation < GAUGE_YELLOW_THRESHOLD) {
            return "HP・やる気ともに低下しています（HP " + status.remainHp +
                    "%, やる気 " + status.remainMotivation + "%）。休憩をお勧めします。";
        }
        if (status.remainHp < GAUGE_YELLOW_THRESHOLD) {
            return "HPが低下しています（残り " + status.remainHp + "%）。体を休める時間を確保しましょう。";
        }
        return "やる気が低下しています（残り " + status.remainMotivation + "%）。短い休憩で回復を図りましょう。";
    }

    /**
     * 空き時間スロット（内部用）
     */
    private static class TimeSlot {
        LocalDateTime start;
        LocalDateTime end;
        int durationMinutes;

        TimeSlot(LocalDateTime start, LocalDateTime end) {
            this.start = start;
            this.end = end;
            this.durationMinutes = (int) ChronoUnit.MINUTES.between(start, end);
        }
    }

    /**
     * 予定と予定の間の空き時間を検出する。
     * デフォルト稼働時間: 09:00〜18:00（calendar.js の openCreateEvent 初期値 09:00 と整合）
     */
    private List<TimeSlot> findFreeTimeSlots(List<CalendarEvent> events, String date) {
        List<TimeSlot> slots = new ArrayList<>();
        LocalDateTime dayStart = LocalDate.parse(date, DATE_FORMAT).atTime(9, 0);
        LocalDateTime dayEnd = LocalDate.parse(date, DATE_FORMAT).atTime(18, 0);
        DateTimeFormatter dtFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm");

        LocalDateTime cursor = dayStart;

        for (CalendarEvent event : events) {
            LocalDateTime eventStart = LocalDateTime.parse(event.start, dtFormatter);
            LocalDateTime eventEnd = LocalDateTime.parse(event.end, dtFormatter);

            if (eventStart.isAfter(cursor)) {
                slots.add(new TimeSlot(cursor, eventStart));
            }

            if (eventEnd.isAfter(cursor)) {
                cursor = eventEnd;
            }
        }

        if (cursor.isBefore(dayEnd)) {
            slots.add(new TimeSlot(cursor, dayEnd));
        }

        return slots;
    }

    // ==========================================
    // デモ・動作確認用 main
    // ==========================================

    public static void main(String[] args) {
        motivation manager = new motivation();
        String userId = "user001";

        System.out.println("===== やる気・HP管理システム デモ =====\n");

        // 1. HP上限設定
        manager.setMaxHp(userId, 100);

        // 2. やる気設定
        manager.setMaxMotivation(userId, 100);

        // 14. ユーザー設定（回復率・警告閾値）
        manager.updateUserSettings(userId, null, null, 0.8, 80);

        // 3-4. 予定登録（HP・やる気消費量付き）
        CalendarEvent event1 = new CalendarEvent(
                1001L, "プロジェクト会議",
                "2026-06-18T09:00", "2026-06-18T10:30",
                "2026-06-18", "", Visibility.GROUP, false,
                30, 20, userId
        );
        manager.registerEvent(event1);

        CalendarEvent event2 = new CalendarEvent(
                1002L, "資料作成",
                "2026-06-18T11:00", "2026-06-18T13:00",
                "2026-06-18", "", Visibility.PRIVATE, false,
                40, 50, userId
        );
        manager.registerEvent(event2);

        // 5. 自動計算
        System.out.println("\n--- 自動計算 ---");
        DayStatus status = manager.calculateDayStatus(userId, "2026-06-18");
        System.out.println("残HP: " + status.remainHp + "% (" + status.hpCssClass + ")");
        System.out.println("残やる気: " + status.remainMotivation + "% (" + status.motivationCssClass + ")");

        // 6-7. カレンダー表示・ゲージ表示
        System.out.println("\n--- カレンダー表示 ---");
        CalendarDayDisplay display = manager.getCalendarDayDisplay(userId, "2026-06-18");
        System.out.println(display.hpLabel + " [" + display.hpCssClass + "]");
        System.out.println(display.motivationLabel + " [" + display.motivationCssClass + "]");

        // 8. キャパシティ判定
        System.out.println("\n--- キャパシティ判定 ---");
        if (status.capacityExceeded) {
            System.out.println("⚠ " + status.warningMessage);
        } else {
            System.out.println("上限内です。");
        }

        // 9. 予定登録支援（保存前チェック）
        System.out.println("\n--- 予定登録支援 ---");
        PreSaveCheckResult check = manager.preSaveCheck(userId, "2026-06-18", 50, 10, null);
        System.out.println((check.canSave ? "✓ " : "✗ ") + check.message);

        // 10. 翌日影響判定
        System.out.println("\n--- 翌日影響判定 ---");
        NextDayImpact impact = manager.evaluateNextDayImpact(userId, "2026-06-18");
        if (impact.needsAttention) {
            System.out.println("⚠ " + impact.alertMessage);
        } else {
            System.out.println("翌日への影響は軽微です。");
        }

        // 11. 休息提案
        System.out.println("\n--- 休息提案 ---");
        List<RestSuggestion> rests = manager.suggestRestBreaks(userId, "2026-06-18", false);
        for (RestSuggestion rest : rests) {
            System.out.println(rest.suggestedStart + " 〜 " + rest.suggestedEnd +
                    " (" + rest.durationMinutes + "分) - " + rest.reason);
        }

        // 12. 統計分析
        System.out.println("\n--- 週間統計 ---");
        List<StatPoint> weekly = manager.getWeeklyStats(userId, "2026-06-16");
        weekly.forEach(p -> System.out.println(p.date + ": HP残" + p.remainHp +
                "%, やる気残" + p.remainMotivation + "%"));

        // 13. 消費履歴閲覧
        System.out.println("\n--- 消費履歴 ---");
        ConsumptionHistory history = manager.getConsumptionHistory(userId, "2026-06-18");
        System.out.println("HP消費: " + history.hpConsumed + "%, やる気消費: " +
                history.motivationConsumed + "%, 予定数: " + history.eventCount);
        System.out.println("予定: " + history.eventTitles);

        System.out.println("\n===== デモ完了 =====");
    }
}
