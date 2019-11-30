// ==UserScript==
// @name         工数入力サポート
// @namespace    https://userscripts.ai2-jp.com/
// @version      0.1
// @description  ジョブカン勤怠管理の工数管理画面で、簡単入力の時間を比率とした実働時間を均等配分や選択値の記憶をします
// @author       Yasunori Fujie
// @match        https://ssl.jobcan.jp/employee/man-hour-manage
// @match        https://ssl.jobcan.jp/employee/man-hour-template/list
// @grant         none
// ==/UserScript==

class TemplateOptionStorage {
    getKey(templateID) {
        return "com.ai2-jp.userscript.jobcan.man-hour-template-edit.optionConfig[" + templateID + "]"
    }

    exist(templateID) {
        const config = window.localStorage.getItem(this.getKey(templateID));
        return config != null;
    }

    get(templateID) {
        const config = window.localStorage.getItem(this.getKey(templateID));
        if (config) {
            try {
                return JSON.parse(config);
            } catch (e) {
            }
        }
        return {
            items: [],
        };
    }

    set(templateID, config) {
        window.localStorage.setItem(this.getKey(templateID), JSON.stringify(config));
    }

    replaceLatest(templateID) {
        const config = this.get("0");
        if (!this.exist(templateID)) {
            this.set(templateID, config);
        }
        window.localStorage.removeItem(this.getKey("0"));
    }
}

function manHourManagePage(window, $) {
    'use strict';

    let targetTime = 0;
    const lastTemplateKey = "com.ai2-jp.userscript.jobcan.man-hour-manage.last-template_id";
    const templateSelector = "#select-template select";
    const contentsSelector = "#edit-menu-contents tr.daily";
    const storage = new TemplateOptionStorage();

    const templateID = (newID) => {
        const elem = $('#select-template select');
        if (elem.length === 0) return
        if (newID != undefined) {
            elem.val(newID);
            elem.trigger("change");
        } else {
            return elem.val();
        }
    };

    {
        //　最後に選択したテンプレートを設定する
        const original = window.displayManHourData;
        window.displayManHourData = (json) => {
            const ret = original(json);
            targetTime = parseInt($("#edit-menu #hiddenTime").val(), 10);

            if ($(contentsSelector).length < 1) {
                const lastTemplate = localStorage.getItem(lastTemplateKey);
                if (lastTemplate) {
                    if ($(templateSelector + " option[value=" + lastTemplate + "]").length != 0) {
                        templateID(lastTemplate);
                    }
                }
            }
            return ret;
        };

    }
    {
        //　テンプレートの時間と稼働時間に合わせ時間を配分する
        const original = window.setTemplate;

        const setTemplate = (json) => {
            const currentTemplateID = templateID();
            const optionConfig = storage.get(currentTemplateID);

            const fixedTimeFilter = (k) => {
                const itemConf = optionConfig.items[k - 1];
                if (!itemConf || !itemConf.fixedTime) {
                    return true
                }
                return false
            };

            const templateTotal = Object.keys(json).filter(fixedTimeFilter).map(k => json[k]).reduce((now, v) => {
                return parseInt(v.minutes, 10) + now
            }, 0);
            const fixedTotal = Object.keys(json).filter(k => !fixedTimeFilter(k)).map(k => json[k]).reduce((now, v) => {
                return parseInt(v.minutes, 10) + now
            }, 0);
            const scale = (targetTime - fixedTotal) / templateTotal;

            if (0 < targetTime) {
                for (const k of Object.keys(json)) {
                    const itemConfig = optionConfig.items[k - 1];
                    if (itemConfig && itemConfig.fixedTime) {
                        continue;
                    }
                    const v = json[k];
                    const minutes = v.minutes = Math.round(v.minutes * scale);
                    const h = Math.floor(minutes / 60);
                    const m = minutes % 60;
                    v.time = h.toString() + ":" + ("0" + m).slice(-2)
                }
            }

            // デフォルトを更新
            if (!optionConfig.noDefaultUpdate) {
                localStorage.setItem(lastTemplateKey, currentTemplateID);
            }

            return original(json);
        };

        window.setTemplate = setTemplate;
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
            console.log(target.value);
        }
    });
}

function manHourTemplateEdit(window, $) {
    const original = window.displayManHourData;
    const storage = new TemplateOptionStorage();
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

    if (0 < storage.get("0").items) {
        // 最後に保存したテンプレートを正しいIDへアサイン(post時にIDが決定されるため)
        storage.replaceLatest(latest);
    }

    const templates = $("#search-result tr");
    templates.each((idx, tr) => {
        tr = $(tr);
        if (idx === 0) {
            tr.append($("<th>").text("デフォルトに設定しない"));
        } else if (idx === templates.length - 1) {
            tr.append($("<td>").text("--"));
        } else {
            const templateID = tr.data("template_id");
            const config = storage.get(templateID);
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
        const config = storage.get(templateID);
        config.noDefaultUpdate = checked;
        storage.set(templateID, config);
    };

    window.displayManHourData = (json) => {
        original(json);
        const targetTable = $("table.man-hour-table-edit tr");
        const templateID = $("#edit-menu input[name='template_id']").val();
        const config = storage.get(templateID);

        // 追加時用のテンプレートに設定項目を追加する
        $("tr#original").append($("<td>").append($(fixedTimeCheckBox)));

        // テンプレートに固定時間の設定項目を追加する
        targetTable.each((idx, tr) => {
            tr = $(tr);
            if (idx === 0) {
                tr.append($("<th>").text("固定時間"));
            } else if (idx === 1) {
                tr.append($("<td>").text("--"));
            } else {
                const cb1 = $(fixedTimeCheckBox);
                const itemConfig = config.items[idx - 2];
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
            const items = config.items = [];

            targetTable.each((idx, tr) => {
                tr = $(tr);
                if (1 < idx) {
                    const fixedTime = tr.find("input.fixed-time").is(':checked');
                    items.push({
                        fixedTime: fixedTime,
                    });
                }
            });

            storage.set(templateID, config);

            return true;
        });

        window.resizeElms();
    };
}

(function (window, $) {
    'use strict';
    var url = window.location.href;

    if (url.indexOf("https://ssl.jobcan.jp/employee/man-hour-manage") === 0) {
        manHourManagePage(window, $);
    } else if (url.indexOf("https://ssl.jobcan.jp/employee/man-hour-template/list") === 0) {
        manHourTemplateEdit(window, $);
    }
})(window, $);