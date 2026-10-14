import { Text, View } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { brand, usePalette } from "@/theme";

/** The Involoops mark: two violet strokes, same paths as the website logo. */
export function Logo({ wordmark = true, size = 36 }: { wordmark?: boolean; size?: number }) {
  const colors = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <G fill="none" stroke={brand.violet} strokeWidth={10} strokeLinecap="round">
          <Path d="M30 60c0-14 10-24 22-24 8 0 14 5 18 12 4 7 10 12 18 12 12 0 22-10 22-22" />
          <Path d="M90 60c0 14-10 24-22 24-8 0-14-5-18-12-4-7-10-12-18-12-12 0-22 10-22 22" />
        </G>
      </Svg>
      {wordmark ? (
        <Text
          style={{
            color: colors.label,
            fontSize: size * 0.62,
            fontWeight: "600",
            letterSpacing: -0.8,
          }}
        >
          involoops
        </Text>
      ) : null}
    </View>
  );
}
