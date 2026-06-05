import { useTranslation } from 'react-i18next';
import { Select, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import React, { useState, useEffect } from 'react';

const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  const [selectedLang, setSelectedLang] = useState(i18n.language);
  const [antdLocale, setAntdLocale] = useState(zhCN);

  useEffect(() => {
    setAntdLocale(selectedLang === 'zh' ? zhCN : enUS);
  }, [selectedLang]);

  const handleChange = (value: string) => {
    setSelectedLang(value);
    i18n.changeLanguage(value);
  };

  const options = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
  ];

  return (
    <ConfigProvider locale={antdLocale}>
      <Select
        value={selectedLang}
        onChange={handleChange}
        options={options}
        style={{ width: 120 }}
        bordered={false}
      />
    </ConfigProvider>
  );
};

export default LanguageSwitcher;