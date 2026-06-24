import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class group_share {

    // --- インナークラス定義（データ構造） ---
    
    // メンバーの権限定義
    public enum Role {
        ADMIN,    // 管理者：すべて可能
        EDITOR,   // 編集者：招待のみ可能
        VIEWER    // 閲覧者：予定の閲覧のみ可能
    }

    // 予定の公開範囲定義
    public enum Visibility {
        PUBLIC,       // 全体公開
        GROUP,        // グループ公開
        PRIVATE       // 自分のみ（プライベート機能）
    }

    // グループ情報クラス
    public static class Group {
        public String groupId;
        public String groupName;
        public String creatorId;
        public Map<String, Role> memberRoles = new HashMap<>(); // userId -> Role
        public List<String> memberIds = new ArrayList<>();
        
        public Group(String groupId, String groupName, String creatorId) {
            this.groupId = groupId;
            this.groupName = groupName;
            this.creatorId = creatorId;
            // 作成者を管理者に設定
            this.memberRoles.put(creatorId, Role.ADMIN);
            this.memberIds.add(creatorId);
        }
    }

    // スケジュール・タスク共通クラス
    public static class Event {
        public String eventId;
        public String title;
        public String ownerId;
        public Visibility visibility;
        public boolean isTask;

        public Event(String eventId, String title, String ownerId, Visibility visibility, boolean isTask) {
            this.eventId = eventId;
            this.title = title;
            this.ownerId = ownerId;
            this.visibility = visibility;
            this.isTask = isTask;
        }
    }

    // --- 模擬データベース（メモリ管理） ---
    private Map<String, Group> groupsTable = new HashMap<>(); // groupId -> Group
    private List<Event> eventsTable = new ArrayList<>();

    // --- メソッド実装 ---

    /**
     * 1. グループ作成
     * 誰でも作成可能。グループ名は英数字・日本語・数字のみに対応。
     */
    public Group createGroup(String groupId, String groupName, String creatorId) {
        // バリデーションなどは必要に応じて
        Group newGroup = new Group(groupId, groupName, creatorId);
        groupsTable.put(groupId, newGroup);
        System.out.println("グループ「" + groupName + "」が作成されました。(作成者: " + creatorId + ")");
        return newGroup;
    }

    /**
     * 2. グループ解散
     * グループ作成者（管理者）のみ解散可能。
     * フロントエンド側で「確認ダイアログ」を表示するためのトリガーを想定。
     */
    public boolean dissolveGroup(String groupId, String requesterId, boolean confirmDialogResult) {
        Group group = groupsTable.get(groupId);
        if (group == null) return false;

        // 権限チェック: 作成者（管理者）のみ可能
        if (!group.creatorId.equals(requesterId)) {
            System.out.println("エラー: グループ解散権限がありません。");
            return false;
        }

        // システム：確認ダイアログの返答がOKの場合のみ処理
        if (confirmDialogResult) {
            groupsTable.remove(groupId);
            System.out.println("グループ「" + group.groupName + "」が解散されました。");
            return true;
        }
        
        System.out.println("グループ解散がキャンセルされました。");
        return false;
    }

    /**
     * 3. グループ脱退
     * 複数所属しているグループから1つを指定して脱退。
     * フロントエンド側で「確認ダイアログ」を表示するためのトリガーを想定。
     */
    public boolean leaveGroup(String groupId, String userId, boolean confirmDialogResult) {
        Group group = groupsTable.get(groupId);
        if (group == null || !group.memberIds.contains(userId)) return false;

        // 管理者は一人で解散せずに脱退することは不可とする単純ルール（必要に応じて調整）
        if (group.creatorId.equals(userId)) {
            System.out.println("管理者は脱退できません。解散を行ってください。");
            return false;
        }

        // システム：確認ダイアログの返答がOKの場合のみ処理
        if (confirmDialogResult) {
            group.memberIds.remove(userId);
            group.memberRoles.remove(userId);
            System.out.println("ユーザー「" + userId + "」がグループから脱退しました。");
            return true;
        }

        System.out.println("グループ脱退がキャンセルされました。");
        return false;
    }

    /**
     * 4. メンバー招待
     * 管理者（ADMIN）または編集者（EDITOR）が招待可能。
     * 招待メンバーはデフォルトで「閲覧者（VIEWER）」。最大20名まで。
     */
    public boolean inviteMember(String groupId, String requesterId, String targetUserId) {
        Group group = groupsTable.get(groupId);
        if (group == null) return false;

        // 上限20名のチェック
        if (group.memberIds.size() >= 20) {
            System.out.println("エラー: グループの定員（20名）に達しています。");
            return false;
        }

        // 権限チェック: 管理者または編集者のみ可能
        Role requesterRole = group.memberRoles.get(requesterId);
        if (requesterRole == Role.ADMIN || requesterRole == Role.EDITOR) {
            if (!group.memberIds.contains(targetUserId)) {
                group.memberIds.add(targetUserId);
                group.memberRoles.put(targetUserId, Role.VIEWER); // デフォルトは閲覧者
                System.out.println("ユーザー「" + targetUserId + "」を閲覧者として招待しました。");
                return true;
            }
        }
        
        System.out.println("エラー: メンバー招待の権限がないか、既にメンバーです。");
        return false;
    }

    /**
     * 5. メンバー削除
     * 管理者（ADMIN）のみ可能。
     */
    public boolean removeMember(String groupId, String requesterId, String targetUserId) {
        Group group = groupsTable.get(groupId);
        if (group == null) return false;

        // 権限チェック: 管理者のみ可能
        Role requesterRole = group.memberRoles.get(requesterId);
        if (requesterRole != Role.ADMIN) {
            System.out.println("エラー: メンバー削除権限がありません。");
            return false;
        }

        if (group.memberIds.contains(targetUserId) && !targetUserId.equals(group.creatorId)) {
            group.memberIds.remove(targetUserId);
            group.memberRoles.remove(targetUserId);
            System.out.println("ユーザー「" + targetUserId + "」をグループから削除しました。");
            return true;
        }
        return false;
    }

    /**
     * 6. 権限管理
     * 管理者（ADMIN）がメンバーの権限を変更。
     */
    public boolean updateRole(String groupId, String requesterId, String targetUserId, Role newRole) {
        Group group = groupsTable.get(groupId);
        if (group == null) return false;

        // 権限チェック: 管理者のみ可能
        Role requesterRole = group.memberRoles.get(requesterId);
        if (requesterRole != Role.ADMIN) {
            System.out.println("エラー: 権限変更の権利がありません。");
            return false;
        }

        if (group.memberIds.contains(targetUserId)) {
            group.memberRoles.put(targetUserId, newRole);
            System.out.println("ユーザー「" + targetUserId + "」の権限を " + newRole + " に変更しました。");
            return true;
        }
        return false;
    }

    /**
     * 7. 予定・タスク共有 & 8. WebSocketリアルタイム更新
     * 管理者・編集者が登録可能（閲覧者は閲覧のみ）。
     * 登録成功後、システムがWebSocketを模したリアルタイム通知を呼び出します。
     */
    public boolean shareScheduleOrTask(String groupId, String requesterId, Event event) {
        Group group = groupsTable.get(groupId);
        if (group == null) return false;

        // 権限チェック: 閲覧者（VIEWER）は共有登録不可
        Role requesterRole = group.memberRoles.get(requesterId);
        if (requesterRole == Role.VIEWER) {
            System.out.println("エラー: 閲覧者権限では予定・タスクの登録はできません。");
            return false;
        }

        eventsTable.add(event);
        System.out.println("グループ「" + groupId + "」に新しく " + (event.isTask ? "タスク" : "予定") + " が登録されました。");
        
        // システム機能：WebSocketによるリアルタイム更新をキック
        broadcastToGroup(groupId, "NEW_EVENT", event.title);
        return true;
    }

    /**
     * 9. プライベート予定作成 / 予定公開範囲設定
     * 公開範囲（全体公開・グループ公開・自分のみ）を項目ごとに指定して登録。
     */
    public void createPrivateEvent(String eventId, String title, String ownerId, Visibility visibility) {
        Event privateEvent = new Event(eventId, title, ownerId, visibility, false);
        eventsTable.add(privateEvent);
        System.out.println("予定「" + title + "」を公開範囲: " + visibility + " で登録しました。");
    }

    /**
     * 10. システム機能：WebSocketリアルタイム更新（ブロードキャスト）
     * 予定・タスク変更時にグループのメンバーにリアルタイム同期を行います。
     */
    private void broadcastToGroup(String groupId, String action, String message) {
        Group group = groupsTable.get(groupId);
        if (group == null) return;

        System.out.println("--- [WebSocket通知] ---");
        for (String memberId : group.memberIds) {
            // 実際はここで対応するユーザーのWebSocketセッションにデータを送信します
            System.out.println("ユーザー「" + memberId + "」へ通知送信 [" + action + "]: " + message);
        }
        System.out.println("------------------------");
    }
}