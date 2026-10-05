# kotlinx.serialization: модели в app.lifecommit.core читаются по сгенерированным сериализаторам.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers @kotlinx.serialization.Serializable class app.lifecommit.core.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class app.lifecommit.core.**$$serializer { *; }
