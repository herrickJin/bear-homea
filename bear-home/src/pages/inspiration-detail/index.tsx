import { useEffect, useState } from "react";
import Taro, { useRouter } from "@tarojs/taro";
import { Button, View } from "@tarojs/components";
import Screen from "../../components/Screen";
import Bear from "../../components/Bear";
import LinkDetailSheet from "../../components/LinkDetailSheet";
import * as inspiration from "../../services/inspiration";
import type { Category, InspirationLink } from "../../services/inspiration";

/** 直链入口（如刷新/分享 URL）。常规打开走方案库页内弹层（LinkDetailSheet），
 *  本页仅负责取数后渲染同一覆盖层，关闭即返回列表。 */
export default function Page() {
  const router = useRouter();
  const id = router.params.id ?? "";
  const [link, setLink] = useState<InspirationLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>(() => []);

  useEffect(() => {
    let alive = true;
    Promise.all([inspiration.fetchLink(id), inspiration.listCategories()]).then(
      ([item, cats]) => {
        if (!alive) return;
        setLink(item);
        setCategories(cats);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [id]);

  function goBack() {
    Taro.navigateBack().catch(() =>
      Taro.redirectTo({ url: "/pages/inspiration/index" }),
    );
  }

  if (loading) {
    return (
      <Screen page="inspiration" hideHeading>
        <View className="ui-section panel">
          <View className="ui-div empty">
            <View className="ui-h3">加载中…</View>
          </View>
        </View>
      </Screen>
    );
  }

  if (!link) {
    return (
      <Screen page="inspiration" hideHeading>
        <View className="ui-section panel">
          <View className="ui-div empty">
            <Bear />
            <View className="ui-h3">没有找到这条笔记</View>
            <View className="ui-p">它可能已经被删掉了，回笔记库看看。</View>
            <Button
              ariaRole="button"
              className="ui-button primary"
              onClick={goBack}
            >
              返回笔记库
            </Button>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen page="inspiration" hideHeading>
      <LinkDetailSheet
        link={link}
        categories={categories}
        onClose={goBack}
        onChange={setLink}
        onDeleted={goBack}
      />
    </Screen>
  );
}
