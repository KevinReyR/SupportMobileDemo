import React from "react";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

export interface PdfViewerProps {
  uri: string;
  onLoad?: () => void;
  onError: (message: string) => void;
}

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export default function PdfViewer({ uri, onLoad, onError }: PdfViewerProps) {
  if (isExpoGo) {
    const openDocument = async () => {
      try {
        await Linking.openURL(uri);
        onLoad?.();
      } catch (error) {
        onError(error instanceof Error ? error.message : "No fue posible abrir el PDF.");
      }
    };

    return (
      <View style={styles.fallback}>
        <Text style={styles.title}>Vista previa externa en Expo Go</Text>
        <Text style={styles.body}>
          El visor embebido estará disponible en el development build. Puedes abrir este
          documento mediante su enlace temporal seguro.
        </Text>
        <Pressable style={styles.button} onPress={openDocument}>
          <Text style={styles.buttonText}>Abrir documento PDF</Text>
        </Pressable>
      </View>
    );
  }

  // Load the native module only inside a development or production build.
  const Pdf = require("react-native-pdf").default as typeof import("react-native-pdf").default;
  return (
    <View style={styles.container}>
      <Pdf
        source={{ uri, cache: true, expiration: 300 }}
        style={styles.pdf}
        trustAllCerts={false}
        enablePaging={false}
        onLoadComplete={onLoad}
        onError={(error) =>
          onError(error instanceof Error ? error.message : "No fue posible mostrar el PDF.")
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#E9EDF5" },
  pdf: { flex: 1, backgroundColor: "#E9EDF5" },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 28,
    backgroundColor: "#F4F6FA",
  },
  title: { color: "#17213A", fontSize: 18, fontWeight: "800", textAlign: "center" },
  body: { color: "#677187", fontSize: 13, lineHeight: 20, textAlign: "center" },
  button: {
    minHeight: 50,
    borderRadius: 15,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#15285A",
  },
  buttonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
});
