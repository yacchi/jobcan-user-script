// ==UserScript==
// @name         ジョブカン入力サポート
// @namespace    https://github.com/yacchi/jobcan-user-script
// @version      1.0.0
// @description  ジョブカン勤怠管理の工数管理画面で、簡単入力の時間を比率とした実働時間を均等配分や選択値の記憶をします
// @author       yacchi
// @match        https://ssl.jobcan.jp/employee/man-hour-manage
// @match        https://ssl.jobcan.jp/employee/man-hour-template/list
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

function migrateConfig(domain) {
    function convert(parent, key, val) {
        const pos = key.indexOf(".")
        let subKey = ""
        if (0 < pos) {
            subKey = key.slice(pos + 1)
            key = key.slice(0, pos)
        } else {
            const m = key.match(/(\w+)\[(\w+)]/)
            if (m) {
                key = m[1]
                subKey = m[2]
            }
        }
        if (subKey) {
            if (!parent[key]) {
                parent[key] = {}
            }
            convert(parent[key], subKey, val)
        } else {
            parent[key] = val
        }
    }

    const prefix = domain.split(".").reverse().join(".") + ".userscript.jobcan."
    const deletes = []
    const conf = Object.keys(localStorage).filter(k => 0 === k.indexOf(prefix)).reduce((root, k) => {
        const key = k.replace(prefix, "")
        convert(root, key, JSON.parse(localStorage.getItem(k)))
        deletes.push(k)
        return root
    }, {})
    if (Object.keys(conf).length) {
        GM_setValue(domain, conf)
        deletes.forEach(k => localStorage.removeItem(k))
    }
}

const TemplateEditPage = "man-hour-template-edit"
const EditPage = "man-hour-manage"

class ConfigStorage {
    constructor(domain) {
        this.domain = domain
        this.conf = GM_getValue(domain, {})

        if (!this.conf[TemplateEditPage]) {
            this.conf[TemplateEditPage] = {}
        }
        if (!this.conf[TemplateEditPage]["optionConfig"]) {
            this.conf[TemplateEditPage].optionConfig = {}
        }
        this.templateConfigs = this.conf[TemplateEditPage].optionConfig

        if (!this.conf[EditPage]) {
            this.conf[EditPage] = {}
        }
        this.editPageAttrs = this.conf[EditPage]
    }


    update() {
        GM_setValue(this.domain, this.conf)
    }

    existTemplateConfig(templateID) {
        return templateID in this.templateConfigs
    }

    getTemplateConfig(templateID) {
        return this.templateConfigs[templateID] || {
            items: [],
            noDefaultUpdate: false,
        }
    }

    setTemplateConfig(templateID, config) {
        this.templateConfigs[templateID] = config
        this.update()
    }

    removeTemplateConfig(templateID) {
        delete this.templateConfigs[templateID]
        this.update()
    }

    updateLastInsertedTemplateID(templateID) {
        const config = this.getTemplateConfig("0");
        if (!this.existTemplateConfig(templateID)) {
            this.templateConfigs[templateID] = config
            delete this.templateConfigs["0"]
            this.update()
        }
    }

    getLastTemplateID() {
        return this.editPageAttrs["last-template_id"]
    }

    updateLastSelectedTemplateID(templateID) {
        this.editPageAttrs["last-template_id"] = templateID
        this.update()
    }
}

function manHourManagePage(window, $, domain) {
    'use strict';

    let targetTime = 0;
    const manHourManageCurrentPageKey = "userscript.jobcan.man-hour-manage.currentPage";

    {
        const currentDate = () => {
            const year = $("[name=year]").val();
            const month = $("[name=month]").val();
            return {
                year: year,
                month: month,
            }
        }

        const updateCurrentPage = () => {
            const current = currentDate();
            window.sessionStorage.setItem(manHourManageCurrentPageKey, JSON.stringify(current));
        };

        const getSavedCurrentPage = () => {
            const s = window.sessionStorage.getItem(manHourManageCurrentPageKey);
            if (s != null) {
                return JSON.parse(s);
            }
        }

        // 表示月度の保存
        const searchElem = document.getElementById("search");
        const orig = searchElem.submit;
        searchElem.submit = () => {
            updateCurrentPage();
            return orig.call(searchElem);
        };

        // 表示月度の調整
        const current = getSavedCurrentPage();
        if (current != null) {
            const now = currentDate();
            if (now.year !== current.year || now.month !== current.month) {
                $(searchElem).find("[name=year]").val(current.year);
                $(searchElem).find("[name=month]").val(current.month);
                $(searchElem).submit();
            }
        }
    }

    const templateSelector = "#select-template select";
    const contentsSelector = "#edit-menu-contents tr.daily";
    const saveFrameName = "save-frame"
    const storage = new ConfigStorage(domain);

    const templateID = (newID) => {
        const elem = $('#select-template select');
        if (elem.length === 0) return;
        if (newID != null) {
            elem.val(newID);
            elem.trigger("change");
        } else {
            return elem.val();
        }
    };

    // 保存先ページの変更
    {
        const frame = $("<iframe>").attr("id", saveFrameName).attr("name", saveFrameName);
        frame.appendTo("body");
    }

    {
        //　最後に選択したテンプレートを設定する
        const original = window.displayManHourData;
        window.displayManHourData = (json) => {
            const ret = original(json);
            targetTime = parseInt($("#edit-menu #hiddenTime").val(), 10);

            if ($(contentsSelector).length < 1) {
                const lastTemplate = storage.getLastTemplateID();
                if (lastTemplate) {
                    if ($(templateSelector + " option[value=" + lastTemplate + "]").length !== 0) {
                        templateID(lastTemplate);
                    }
                }
            }

            // フォームのターゲットをiframeに変更
            $("#save-form").attr("target", saveFrameName);

            $("#save").on("click", () => {
                const frame = $("#save-frame");
                let timerID;
                timerID = setInterval(() => {
                    const state = frame.contents()[0].readyState;
                    if (state !== "complete") {
                        frame.remove();
                        location.reload();
                        clearInterval(timerID);
                    }
                }, 30);
            });

            // プロジェクト更新時に、タスクの先頭が選択された状態にする
            $(".man-hour-table-edit").on("change", "select[name='projects[]']", (event) => {
                const tr = $(event.target).closest("tr")
                const taskSelector = tr.find("select[name='tasks[]'")
                taskSelector.val(taskSelector.find("option")[1].value)
            })

            return ret;
        };
    }

    if ($("#man-hour-manage-modal").length === 1) {
        //　実働時間と工数に差異がある行を分かりやすくする
        $("table.jbc-table tr").each((_, e) => {
            const cols = $(e).find("td");
            if (cols.length < 1) {
                return;
            }
            const v1 = cols[1].innerText.trim(), v2 = cols[2].innerText.trim();
            if (v1 === v2) {
                return;
            }
            if (v1 === "00:00" && v2 === "入力がありません") {
                return;
            }
            $(e).css("background-color", "rgba(255, 0, 0, 0.3)");
        });
    }

    {
        //　テンプレートの時間と稼働時間に合わせ時間を配分する
        const original = window.setTemplate;

        window.setTemplate = (json) => {
            const currentTemplateID = templateID();
            const optionConfig = storage.getTemplateConfig(currentTemplateID);

            const isFixedTime = (k) => {
                const itemConf = optionConfig.items[k - 1];
                return itemConf && itemConf.fixedTime;
            };

            const totalTimeReducer = (now, v) => {
                return parseInt(v.minutes, 10) + now;
            };

            const templateTotal = Object.keys(json).filter(k => !isFixedTime(k)).map(k => json[k]).reduce(totalTimeReducer, 0);
            const fixedTotal = Object.keys(json).filter(isFixedTime).map(k => json[k]).reduce(totalTimeReducer, 0);
            const scale = (targetTime - fixedTotal) / templateTotal;

            // 合計時間の差分を計算して調整
            const scaledTotal = Object.keys(json).map(k => {
                const v = json[k], m = parseInt(v.minutes, 10);
                return isFixedTime(k) ? m : Math.round(m * scale)
            }).reduce((now, m) => now + m, 0);

            // 実働時間と配分後の合計時間から差分を計算
            const diff = targetTime - scaledTotal;

            // 差分を分配するための配列を作成
            const diffArray = Array(Math.abs(diff)).fill(diff / Math.abs(diff));

            if (0 < targetTime) {
                for (const k of Object.keys(json)) {
                    if (isFixedTime(k)) {
                        continue;
                    }
                    const v = json[k];
                    let minutes = v.minutes = Math.round(v.minutes * scale);
                    if (diffArray.length) {
                        minutes += diffArray.pop();
                    }
                    const h = Math.floor(minutes / 60);
                    const m = minutes % 60;
                    v.time = h.toString() + ":" + ("0" + m).slice(-2)
                }
            }

            // デフォルトを更新
            if (!optionConfig.noDefaultUpdate) {
                storage.updateLastSelectedTemplateID(currentTemplateID)
            }

            return original(json);
        };
    }

    // 工数に:を補完する
    $("#edit-menu").on("blur", "input.man-hour-input-time", (event) => {
        const target = event.target;
        let v = target.value;
        // :の補完の不具合への対策
        if (v.indexOf("00:") === 0 && 4 < v.length) {
            v = v.replace("00:", "");
        }
        if (v.indexOf(":") < 0) {
            if (v.length < 3 || 4 < v.length) {
                return;
            }
            if (v.length === 3) {
                target.value = "0" + v.substring(0, 1) + ":" + v.substring(1);
            } else {
                target.value = v.substring(0, 2) + ":" + v.substring(2);
            }
        }
    });
}

function manHourTemplateEdit(window, $, domain) {
    const original = window.displayManHourData;
    const storage = new ConfigStorage(domain);
    const fixedTimeCheckBox = "<input class='fixed-time' type='checkbox'>";
    const noDefaultUpdateCheckBox = "<input class='no-default-update' type='checkbox' onclick='setNoDefaultUpdate(this)'>";

    let latest = 0;
    $("#search-result td button.btn-info").each((idx, btn) => {
        const templateID = parseInt(btn.getAttribute("onclick").match(/(\d+)/, "$1")[0]);
        $(btn).closest("tr").data("template_id", templateID);
        if (latest < templateID) {
            latest = templateID;
        }
    });

    if (0 < storage.getTemplateConfig("0").items) {
        // 最後に保存したテンプレートを正しいIDへアサイン(post時にIDが決定されるため)
        storage.updateLastInsertedTemplateID(latest);
    }

    const templates = $("#search-result tr");
    templates.each((idx, tr) => {
        tr = $(tr);
        if (idx === 0) {
            tr.append($("<th>").text("デフォルトに設定しない"));
        } else if (idx === templates.length - 1) {
            tr.append($("<td>").text("--"));
        } else {
            let templateID = tr.data("template_id");
            if (!templateID) {
                const m = tr.find("td button")[0].onclick.toString().match(/\((\d+)\)/)
                if (m) {
                    templateID = m[1]
                    tr.data("template_id", templateID)
                }
            }
            const config = storage.getTemplateConfig(templateID);
            const cb = $(noDefaultUpdateCheckBox);
            if (config.noDefaultUpdate) {
                cb.prop("checked", true);
            }
            tr.append($("<td>").append(cb));
        }
    });

    // デフォルトに設定しないの状態を保存
    window.setNoDefaultUpdate = (elem) => {
        const checked = elem.checked;
        const templateID = $(elem).closest("tr").data("template_id");
        const config = storage.getTemplateConfig(templateID);
        config.noDefaultUpdate = checked;
        storage.setTemplateConfig(templateID, config);
    };

    window.displayManHourData = (json) => {
        original(json);
        const tableHeader = $("#man-hour-manage-modal thead tr")
        const targetTable = $("#man-hour-manage-modal tbody.man-hour-table-edit tr");
        const templateID = $("#edit-menu input[name='template_id']").val();
        const config = storage.getTemplateConfig(templateID);

        // 追加時用のテンプレートに設定項目を追加する
        $("tr#original").append($("<td>").append($(fixedTimeCheckBox)));

        // テンプレートに固定時間の設定項目を追加する
        tableHeader.append($("<th>").text("固定時間"))
        targetTable.each((idx, tr) => {
            tr = $(tr);
            if (idx === 0) {
                tr.append($("<td>").text("--"));
            } else {
                const cb1 = $(fixedTimeCheckBox);
                const itemConfig = config.items[idx - 1];
                if (itemConfig) {
                    if (itemConfig.fixedTime) {
                        cb1.prop('checked', true);
                    }
                }
                tr.append($("<td>").append(cb1));
            }
        });

        // ローカルストレージに保存
        $("#edit-menu").submit(() => {
            const items = [];

            targetTable.each((idx, tr) => {
                tr = $(tr);
                if (0 < idx) {
                    const fixedTime = tr.find("input.fixed-time").is(':checked');
                    items.push({
                        fixedTime: fixedTime,
                    });
                }
            });

            config.items = items;
            storage.setTemplateConfig(templateID, config);

            return true;
        });

        // window.resizeElms();
    };
}

(function (window, $) {
    'use strict';
    const url = window.location.href;

    const mail = $("#jbcid-dropdown-button").text()
    const domain = mail.slice(mail.indexOf("@") + 1)

    if (domain) {
        migrateConfig(domain)

        if (url.indexOf("https://ssl.jobcan.jp/employee/man-hour-manage") === 0) {
            manHourManagePage(window, $, domain);
        } else if (url.indexOf("https://ssl.jobcan.jp/employee/man-hour-template/list") === 0) {
            manHourTemplateEdit(window, $, domain);
        }
    }
})(window.unsafeWindow, $);
