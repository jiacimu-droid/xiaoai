package com.xiaoai.phone;

/**
 * TapMatch 的純邏輯單元測試：跟 GrantEvidenceTest 一樣用 javac + java 直接跑，
 * 不需要 Android SDK、不需要模擬器。
 *
 *   javac -d /tmp/out app/src/main/java/com/xiaoai/phone/TapMatch.java tests/TapMatchTest.java
 *   java -cp /tmp/out com.xiaoai.phone.TapMatchTest
 */
public final class TapMatchTest {

    private static int fail = 0, run = 0;

    private static void eq(String what, Object got, Object want) {
        run++;
        boolean ok = want == null ? got == null : want.equals(got);
        if (!ok) { fail++; System.out.println("FAIL " + what + " → got " + got + ", want " + want); }
        else System.out.println("PASS " + what);
    }

    public static void main(String[] args) {
        // --- norm ---
        eq("空白與換行會先抹掉", TapMatch.norm("陳\n野 12:30"), "陳野12:30");
        eq("全形空格也抹掉", TapMatch.norm("　微　信　"), "微信");
        eq("英文小寫化", TapMatch.norm("ChatGPT"), "chatgpt");
        eq("null 當成空字串", TapMatch.norm(null), "");

        // --- tier ---
        eq("完全相同是第 1 級", TapMatch.tier("陳野", "陳野"), 1);
        eq("開頭就是是第 2 級", TapMatch.tier("陳野", "陳野 12:30"), 2);
        eq("中間包含是第 3 級", TapMatch.tier("野", "小陳野 12:30"), 3);
        eq("不相干回 0", TapMatch.tier("陳野", "綠子 昨天"), 0);
        eq("空目標不匹配", TapMatch.tier("  ", "陳野"), 0);

        // --- risky ---
        eq("發送屬危險字", TapMatch.risky("發送消息"), true);
        eq("刪除屬危險字", TapMatch.risky("删除"), true);
        eq("普通名字不危險", TapMatch.risky("陳野 12:30"), false);

        // --- choose：真實微信列表的樣子 ---
        String[] list = {"12:30", "綠子 昨天 在嗎", "陳野 22:04 晚安", "文件傳輸助手"};
        eq("列表行用「名字」就能點進去", TapMatch.choose("陳野", list), 2);
        eq("完全相同的名字優先", TapMatch.choose("文件傳輸助手", list), 3);
        eq("只有前綴匹配也算找到", TapMatch.choose("綠子", list), 1);
        eq("名字中間多一個空格也要中", TapMatch.choose("陳 野", list), 2);

        // 同一個名字出現在兩個勢均力敵的行 → 停下來，不要亂點
        eq("勢均力敵要回模稜", TapMatch.choose("陳野", new String[]{"陳野 12:30", "陳野 22:04"}), TapMatch.AMBIGUOUS);
        // 有完全相同的那個就不算模稜
        eq("有完全相同時不模稜", TapMatch.choose("陳野", new String[]{"陳野 12:30", "陳野"}), 1);
        // 危險字候选直接略過
        eq("含危險字的候选不給點", TapMatch.choose("發送", new String[]{"發送", "發送消息"}), TapMatch.NONE);
        eq("找不到就回 NONE", TapMatch.choose("查無此人", list), TapMatch.NONE);
        eq("空清單回 NONE", TapMatch.choose("陳野", new String[]{}), TapMatch.NONE);
        eq("null 清單回 NONE", TapMatch.choose("陳野", null), TapMatch.NONE);

        System.out.println("\n" + (run - fail) + "/" + run + " 通過");
        if (fail > 0) System.exit(1);
    }
}
