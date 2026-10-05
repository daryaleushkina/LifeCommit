// Значок привычки по её названию — без ИИ: словарь начал слов (русских и английских), как shared/habitIcon.ts.
// Правило срабатывает, если какое-то слово названия НАЧИНАЕТСЯ с корня: «вод» ловит «воды», но не «завод».
// Порядок правил важен: первое совпадение побеждает. Меняется словарь в мини-аппе — меняется и здесь.
import Foundation

public enum HabitIcon: String, Sendable, CaseIterable {
    case gym, run, walk, yoga, exercise, swim, bike, water, read, study, write, sleep, meds, food,
         sweets, smoke, alcohol, coffee, phone, clean, money, work, music, art, care, pet, people

    static let rules: [(HabitIcon, [String])] = [
        // «курс» и «куриц» раньше, чем «кури»: иначе курсы и курица стали бы сигаретой
        (.study, ["курс", "англ", "язык", "слов", "учи", "учеб", "урок", "лекци", "экзамен", "study", "learn", "english", "lesson", "course", "word"]),
        (.food, ["куриц", "еда", "есть", "завтрак", "обед", "ужин", "овощ", "фрукт", "салат", "готов", "eat", "food", "breakfast", "lunch", "dinner", "cook", "vegetable", "fruit"]),
        (.smoke, ["кури", "курен", "сигарет", "вейп", "табак", "smok", "cigarette", "vape"]),
        (.alcohol, ["алкогол", "пив", "вино", "вина", "выпив", "буха", "alcohol", "beer", "wine", "booze"]),
        (.coffee, ["кофе", "кофеин", "coffee", "caffeine"]),
        (.sweets, ["сладк", "сахар", "конфет", "шоколад", "десерт", "sugar", "sweet", "candy", "chocolate", "dessert"]),
        (.phone, ["соцсет", "телефон", "инст", "тикток", "ютуб", "экран", "скрол", "сериал", "phone", "social", "scroll", "screen", "tiktok", "instagram", "youtube"]),
        (.gym, ["спортзал", "зал", "трениров", "качалк", "фитнес", "штанг", "гантел", "gym", "workout", "training", "fitness", "lift"]),
        (.run, ["бег", "пробеж", "run", "jog"]),
        (.swim, ["плав", "бассейн", "swim", "pool"]),
        (.bike, ["вело", "bike", "cycl"]),
        (.pet, ["собак", "кот", "кошк", "питом", "dog", "cat", "pet"]),
        (.walk, ["прогул", "гуля", "шаг", "ходьб", "ходить", "walk", "step"]),
        (.yoga, ["йог", "растяж", "медит", "дыхан", "yoga", "stretch", "meditat", "breath"]),
        (.exercise, ["зарядк", "отжим", "присед", "планк", "подтяг", "пресс", "exercise", "push", "squat", "plank"]),
        (.water, ["вод", "стакан", "water", "hydrat"]),
        (.read, ["чит", "чтен", "книг", "страниц", "read", "book", "page"]),
        (.write, ["дневник", "писать", "пишу", "замет", "journal", "diary", "writ"]),
        (.sleep, ["сон", "спать", "лечь", "ложи", "встать", "встав", "подъем", "sleep", "bed", "wake"]),
        (.meds, ["таблет", "витамин", "лекарств", "pill", "vitamin", "med"]),
        (.care, ["зуб", "душ", "умы", "уход", "кож", "крем", "teeth", "shower", "skin", "floss"]),
        (.clean, ["убор", "убра", "посуд", "стирк", "порядок", "пылесос", "clean", "tidy", "dish", "laundry"]),
        (.money, ["деньг", "копи", "бюджет", "расход", "трат", "money", "budget", "sav", "spend"]),
        (.music, ["музык", "гитар", "пиани", "петь", "вокал", "music", "guitar", "piano", "sing"]),
        (.art, ["рис", "живопис", "draw", "paint", "sketch"]),
        (.people, ["позвон", "мам", "пап", "родител", "друз", "семь", "call", "mom", "dad", "family", "friend"]),
        (.work, ["работ", "проект", "задач", "фокус", "код", "work", "project", "focus", "code"]),
    ]

    /// Значок по названию или nil — тогда рисуем значок вида привычки.
    public static func of(_ title: String) -> HabitIcon? {
        let lower = title.lowercased().replacingOccurrences(of: "ё", with: "е")
        // Слова — только латиница a–z и кириллица а–я, как /[^a-zа-я]+/ в мини-аппе.
        var words: [String] = []
        var current = ""
        for ch in lower {
            if ("a"..."z").contains(ch) || ("а"..."я").contains(ch) {
                current.append(ch)
            } else if !current.isEmpty {
                words.append(current)
                current = ""
            }
        }
        if !current.isEmpty { words.append(current) }
        for (icon, stems) in rules where words.contains(where: { w in stems.contains { w.hasPrefix($0) } }) {
            return icon
        }
        return nil
    }
}
